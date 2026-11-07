//! Passwords live in the operating system's keychain (Keychain on macOS,
//! Credential Manager on Windows), never in the profiles file.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::AppError;

pub trait SecretStore: Send + Sync {
    fn get(&self, id: &str) -> Result<Option<String>, AppError>;
    fn set(&self, id: &str, secret: &str) -> Result<(), AppError>;
    fn delete(&self, id: &str) -> Result<(), AppError>;
}

pub struct KeychainStore;

const SERVICE: &str = "fogtrail";

fn entry(id: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, id).map_err(|e| AppError::Secret(e.to_string()))
}

impl SecretStore for KeychainStore {
    fn get(&self, id: &str) -> Result<Option<String>, AppError> {
        match entry(id)?.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Secret(e.to_string())),
        }
    }

    fn set(&self, id: &str, secret: &str) -> Result<(), AppError> {
        entry(id)?
            .set_password(secret)
            .map_err(|e| AppError::Secret(e.to_string()))
    }

    fn delete(&self, id: &str) -> Result<(), AppError> {
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Secret(e.to_string())),
        }
    }
}

/// For tests, and as a fallback when no keychain is available.
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn get(&self, id: &str) -> Result<Option<String>, AppError> {
        Ok(self.0.lock().unwrap().get(id).cloned())
    }
    fn set(&self, id: &str, secret: &str) -> Result<(), AppError> {
        self.0.lock().unwrap().insert(id.into(), secret.into());
        Ok(())
    }
    fn delete(&self, id: &str) -> Result<(), AppError> {
        self.0.lock().unwrap().remove(id);
        Ok(())
    }
}
