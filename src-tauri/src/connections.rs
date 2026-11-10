//! Owns the saved profiles, their secrets and the one active connection.

use std::sync::{Arc, RwLock};

use serde::Serialize;

use crate::drivers::redis::RedisDriver;
use crate::drivers::{ConnectionInfo, Driver, Probe, ServerInfo};
use crate::error::AppError;
use crate::profiles::{Profile, ProfileStore};
use crate::secrets::SecretStore;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub product: String,
    pub version: String,
    pub key_count: u64,
}

impl From<Probe> for TestResult {
    fn from(p: Probe) -> Self {
        Self {
            product: p.product,
            version: p.version,
            key_count: p.key_count,
        }
    }
}

struct Active {
    profile_id: String,
    driver: Arc<dyn Driver>,
    info: ConnectionInfo,
}

pub struct Connections {
    store: ProfileStore,
    secrets: Box<dyn SecretStore>,
    active: RwLock<Option<Active>>,
}

impl Connections {
    pub fn new(store: ProfileStore, secrets: Box<dyn SecretStore>) -> Self {
        Self {
            store,
            secrets,
            active: RwLock::new(None),
        }
    }

    pub fn list(&self) -> Result<Vec<Profile>, AppError> {
        self.store.list()
    }

    /// Saves the profile. `password`: `None` keeps the stored one, an empty
    /// string removes it, anything else replaces it.
    pub fn save(&self, profile: Profile, password: Option<String>) -> Result<Profile, AppError> {
        let saved = self.store.upsert(profile)?;
        match password.as_deref() {
            None => {}
            Some("") => self.secrets.delete(&saved.id)?,
            Some(p) => self.secrets.set(&saved.id, p)?,
        }
        // Edits take effect on the next connect, so drop a stale active link.
        if self.active_id().as_deref() == Some(saved.id.as_str()) {
            self.disconnect();
        }
        Ok(saved)
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        if self.active_id().as_deref() == Some(id) {
            self.disconnect();
        }
        self.store.delete(id)?;
        self.secrets.delete(id)
    }

    /// Tries a profile without saving it. With no password given, an existing
    /// profile's stored one is used, so "Test" works on an untouched form.
    pub async fn test(
        &self,
        profile: &Profile,
        password: Option<String>,
    ) -> Result<TestResult, AppError> {
        profile.validate()?;
        let password = self.password_for(profile, password)?;
        let driver = RedisDriver::new(profile.url(password.as_deref()));
        Ok(driver.probe().await?.into())
    }

    pub async fn connect(&self, id: &str) -> Result<ConnectionInfo, AppError> {
        let profile = self.store.get(id)?;
        self.open(profile).await
    }

    /// Reconnects to another database on the same server. Each database gets its
    /// own connection, so no SELECT state is shared. The saved profile is untouched.
    pub async fn select_database(&self, database: u32) -> Result<ConnectionInfo, AppError> {
        let id = self.active_id().ok_or(AppError::NotConnected)?;
        let mut profile = self.store.get(&id)?;
        profile.database = database;
        self.open(profile)
            .await
            .map_err(|e| friendly_select_error(database, e))
    }

    pub async fn server_info(&self) -> Result<ServerInfo, AppError> {
        self.driver()?.server_info().await
    }

    async fn open(&self, profile: Profile) -> Result<ConnectionInfo, AppError> {
        let password = self.secrets.get(&profile.id)?;
        let driver = Arc::new(RedisDriver::new(profile.url(password.as_deref())));
        let probe = driver.probe().await?;
        let mut info = driver.describe();
        info.driver = format!("{} {}", probe.product, probe.version)
            .trim()
            .to_string();
        info.address = format!("{}:{}", profile.host, profile.port);
        *self.active.write().unwrap() = Some(Active {
            profile_id: profile.id.clone(),
            driver,
            info: info.clone(),
        });
        Ok(info)
    }

    pub fn disconnect(&self) {
        *self.active.write().unwrap() = None;
    }

    pub fn driver(&self) -> Result<Arc<dyn Driver>, AppError> {
        self.active
            .read()
            .unwrap()
            .as_ref()
            .map(|a| a.driver.clone())
            .ok_or(AppError::NotConnected)
    }

    pub fn info(&self) -> Result<ConnectionInfo, AppError> {
        self.active
            .read()
            .unwrap()
            .as_ref()
            .map(|a| a.info.clone())
            .ok_or(AppError::NotConnected)
    }

    fn active_id(&self) -> Option<String> {
        self.active
            .read()
            .unwrap()
            .as_ref()
            .map(|a| a.profile_id.clone())
    }

    fn password_for(
        &self,
        profile: &Profile,
        given: Option<String>,
    ) -> Result<Option<String>, AppError> {
        match given {
            Some(p) => Ok(Some(p)),
            None if !profile.id.is_empty() => self.secrets.get(&profile.id),
            None => Ok(None),
        }
    }
}

/// "DB index is out of range" is Redis's way of saying the database doesn't exist.
fn friendly_select_error(database: u32, err: AppError) -> AppError {
    match err {
        AppError::Connect(m) if m.contains("out of range") => {
            AppError::Connect(format!("This server has no database {database}."))
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;

    #[test]
    fn a_missing_database_gets_a_plain_message() {
        let raw = AppError::Connect(
            "Could not connect to h:1: Redis server refused to switch database - Server(ResponseError): DB index is out of range".into(),
        );
        assert_eq!(
            friendly_select_error(3, raw).to_string(),
            "This server has no database 3."
        );
        let other = AppError::Connect("Connection refused".into());
        assert_eq!(
            friendly_select_error(3, other).to_string(),
            "Connection refused"
        );
    }

    fn conns() -> Connections {
        let dir = std::env::temp_dir().join(format!("fogtrail-test-{}", uuid::Uuid::new_v4()));
        Connections::new(
            ProfileStore::new(dir.join("c.json")),
            Box::new(MemoryStore::default()),
        )
    }

    fn profile() -> Profile {
        Profile {
            id: String::new(),
            name: "x".into(),
            driver: "redis".into(),
            host: "127.0.0.1".into(),
            port: 1,
            username: None,
            database: 0,
            tls: false,
        }
    }

    #[test]
    fn no_driver_until_connected() {
        assert!(matches!(conns().driver(), Err(AppError::NotConnected)));
        assert!(matches!(conns().info(), Err(AppError::NotConnected)));
    }

    #[test]
    fn password_semantics() {
        let c = conns();
        let p = c.save(profile(), Some("one".into())).unwrap();
        assert_eq!(c.secrets.get(&p.id).unwrap().as_deref(), Some("one"));
        c.save(p.clone(), None).unwrap();
        assert_eq!(c.secrets.get(&p.id).unwrap().as_deref(), Some("one"));
        c.save(p.clone(), Some("two".into())).unwrap();
        assert_eq!(c.secrets.get(&p.id).unwrap().as_deref(), Some("two"));
        c.save(p.clone(), Some(String::new())).unwrap();
        assert_eq!(c.secrets.get(&p.id).unwrap(), None);
    }

    #[test]
    fn delete_removes_profile_and_secret() {
        let c = conns();
        let p = c.save(profile(), Some("pw".into())).unwrap();
        c.delete(&p.id).unwrap();
        assert!(c.list().unwrap().is_empty());
        assert_eq!(c.secrets.get(&p.id).unwrap(), None);
    }

    #[tokio::test]
    async fn connect_failure_leaves_nothing_active() {
        let c = conns();
        let p = c.save(profile(), None).unwrap();
        assert!(matches!(c.connect(&p.id).await, Err(AppError::Connect(_))));
        assert!(matches!(c.driver(), Err(AppError::NotConnected)));
    }
}
