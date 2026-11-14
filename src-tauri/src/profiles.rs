//! Saved connection profiles. They live in a JSON file in the app data folder
//! and never contain passwords: those go to the OS keychain (see `secrets`).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Empty for a profile that has not been saved yet.
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default = "default_driver")]
    pub driver: String,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    /// Redis database index. MySQL uses `schema` instead.
    #[serde(default)]
    pub database: u32,
    /// Default schema (MySQL database name), if any.
    #[serde(default)]
    pub schema: Option<String>,
    #[serde(default)]
    pub tls: bool,
    /// PostgreSQL database name. A Postgres connection opens exactly one database.
    #[serde(default)]
    pub dbname: Option<String>,
    /// PostgreSQL SSL mode: `disable`, `require` or `verify-full`. Unset means `require`.
    #[serde(default)]
    pub ssl_mode: Option<String>,
}

fn default_driver() -> String {
    "redis".to_string()
}

impl Profile {
    pub fn validate(&self) -> Result<(), AppError> {
        let bad = |m: &str| Err(AppError::InvalidArgument(m.to_string()));
        if self.name.trim().is_empty() {
            return bad("Give the connection a name.");
        }
        if self.host.trim().is_empty() {
            return bad("Enter a host.");
        }
        if self.port == 0 {
            return bad("Enter a port between 1 and 65535.");
        }
        match self.driver.as_str() {
            "redis" | "mysql" => Ok(()),
            "postgres" => {
                if self.username.as_deref().is_none_or(|u| u.trim().is_empty()) {
                    return bad("Enter a user.");
                }
                if self.dbname.as_deref().is_none_or(|d| d.trim().is_empty()) {
                    return bad("Enter a database.");
                }
                match self.ssl_mode.as_deref() {
                    None | Some("disable" | "require" | "verify-full") => Ok(()),
                    Some(_) => bad("SSL mode must be disable, require or verify-full."),
                }
            }
            _ => bad("Only Redis-compatible servers, MySQL and PostgreSQL are supported for now."),
        }
    }

    /// Connection URL, with credentials percent-encoded.
    pub fn url(&self, password: Option<&str>) -> String {
        let scheme = if self.tls { "rediss" } else { "redis" };
        let user = self.username.as_deref().filter(|u| !u.is_empty());
        let pass = password.filter(|p| !p.is_empty());
        let auth = match (user, pass) {
            (None, None) => String::new(),
            (u, p) => format!(
                "{}{}@",
                urlencoding::encode(u.unwrap_or("")),
                p.map(|p| format!(":{}", urlencoding::encode(p)))
                    .unwrap_or_default()
            ),
        };
        let host = self.host.trim();
        let host = if host.contains(':') && !host.starts_with('[') {
            format!("[{host}]")
        } else {
            host.to_string()
        };
        format!("{scheme}://{auth}{host}:{}/{}", self.port, self.database)
    }
}

pub struct ProfileStore {
    path: PathBuf,
}

impl ProfileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn list(&self) -> Result<Vec<Profile>, AppError> {
        match fs::read_to_string(&self.path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| {
                AppError::Storage(format!("{} is not valid: {e}", self.path.display()))
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(AppError::Storage(e.to_string())),
        }
    }

    /// Inserts or replaces by id. A profile without an id gets a new one.
    pub fn upsert(&self, mut profile: Profile) -> Result<Profile, AppError> {
        profile.validate()?;
        profile.name = profile.name.trim().to_string();
        profile.host = profile.host.trim().to_string();
        let mut all = self.list()?;
        if profile.id.is_empty() {
            profile.id = uuid::Uuid::new_v4().to_string();
            all.push(profile.clone());
        } else if let Some(slot) = all.iter_mut().find(|p| p.id == profile.id) {
            *slot = profile.clone();
        } else {
            all.push(profile.clone());
        }
        self.write(&all)?;
        Ok(profile)
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let mut all = self.list()?;
        all.retain(|p| p.id != id);
        self.write(&all)
    }

    pub fn get(&self, id: &str) -> Result<Profile, AppError> {
        self.list()?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| AppError::NotFound(format!("connection {id}")))
    }

    /// Writes to a temp file and renames, so a crash never leaves half a file.
    fn write(&self, all: &[Profile]) -> Result<(), AppError> {
        let io = |e: std::io::Error| AppError::Storage(e.to_string());
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir).map_err(io)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let text =
            serde_json::to_string_pretty(all).map_err(|e| AppError::Storage(e.to_string()))?;
        fs::write(&tmp, text).map_err(io)?;
        fs::rename(&tmp, &self.path).map_err(io)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Profile {
        Profile {
            id: String::new(),
            name: "local".into(),
            driver: "redis".into(),
            host: "127.0.0.1".into(),
            port: 6379,
            username: None,
            database: 0,
            schema: None,
            tls: false,
            dbname: None,
            ssl_mode: None,
        }
    }

    fn store() -> (ProfileStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("fogtrail-test-{}", uuid::Uuid::new_v4()));
        (ProfileStore::new(dir.join("connections.json")), dir)
    }

    #[test]
    fn mysql_is_accepted_and_other_stores_are_not() {
        let mut p = sample();
        p.driver = "mysql".into();
        assert!(p.validate().is_ok());
        p.driver = "oracle".into();
        assert!(p.validate().is_err());
    }

    #[test]
    fn a_profile_saved_before_schemas_existed_still_loads() {
        let old = r#"{"id":"a","name":"x","host":"h","port":6379}"#;
        let p: Profile = serde_json::from_str(old).unwrap();
        assert_eq!(p.driver, "redis");
        assert_eq!(p.schema, None);
        assert!(p.validate().is_ok());
    }

    #[test]
    fn url_plain_and_tls() {
        let mut p = sample();
        assert_eq!(p.url(None), "redis://127.0.0.1:6379/0");
        p.tls = true;
        p.database = 3;
        assert_eq!(p.url(None), "rediss://127.0.0.1:6379/3");
    }

    #[test]
    fn url_encodes_credentials() {
        let mut p = sample();
        p.username = Some("ro user".into());
        assert_eq!(
            p.url(Some("p@ss:/w#rd")),
            "redis://ro%20user:p%40ss%3A%2Fw%23rd@127.0.0.1:6379/0"
        );
        p.username = None;
        assert_eq!(p.url(Some("secret")), "redis://:secret@127.0.0.1:6379/0");
        assert_eq!(p.url(Some("")), "redis://127.0.0.1:6379/0");
    }

    #[test]
    fn url_brackets_ipv6() {
        let mut p = sample();
        p.host = "::1".into();
        assert_eq!(p.url(None), "redis://[::1]:6379/0");
    }

    #[test]
    fn validation_catches_blanks() {
        let mut p = sample();
        p.name = "  ".into();
        assert!(p.validate().is_err());
        let mut p = sample();
        p.host.clear();
        assert!(p.validate().is_err());
        let mut p = sample();
        p.port = 0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn store_round_trip() {
        let (s, dir) = store();
        assert!(s.list().unwrap().is_empty());
        let saved = s.upsert(sample()).unwrap();
        assert!(!saved.id.is_empty());
        let mut edited = saved.clone();
        edited.name = "renamed".into();
        s.upsert(edited).unwrap();
        let all = s.list().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "renamed");
        s.delete(&saved.id).unwrap();
        assert!(s.list().unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupt_file_is_a_storage_error_not_a_panic() {
        let (s, dir) = store();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("connections.json"), "{nope").unwrap();
        assert!(matches!(s.list(), Err(AppError::Storage(_))));
        let _ = fs::remove_dir_all(dir);
    }
}
