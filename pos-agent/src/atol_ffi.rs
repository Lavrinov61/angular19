//! Low-level FFI wrapper for АТОЛ fptr10.dll.
//!
//! Loads the DLL at runtime via LoadLibraryW/GetProcAddress.
//! All unsafe calls are wrapped in safe methods on FptrLib.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use tracing::{debug, info};

// ── АТОЛ constants from fptr10.h ──

pub const LIBFPTR_PARAM_JSON_DATA: i32 = 65645;
pub const LIBFPTR_PARAM_DATA_TYPE: i32 = 65587;
pub const LIBFPTR_PARAM_SHIFT_STATE: i32 = 65592;
pub const LIBFPTR_PARAM_SETTING_ID: i32 = 65650;
pub const LIBFPTR_PARAM_SETTING_VALUE: i32 = 65651;

pub const LIBFPTR_SETTING_PORT: &str = "Port";
pub const LIBFPTR_SETTING_BAUDRATE: &str = "BaudRate";
pub const LIBFPTR_SETTING_COM_FILE: &str = "ComFile";
pub const LIBFPTR_SETTING_MODEL: &str = "Model";

pub const LIBFPTR_PORT_COM: &str = "0";
pub const LIBFPTR_MODEL_AUTO: &str = "500";

pub const LIBFPTR_DT_SHIFT_STATE: i32 = 14;

// ── Error types ──

#[derive(Debug, thiserror::Error)]
pub enum FptrError {
    #[error("LoadLibraryW failed for '{path}': {source}")]
    LoadLibrary {
        path: String,
        source: std::io::Error,
    },

    #[error("GetProcAddress failed for '{func_name}': {source}")]
    GetProcAddress {
        func_name: String,
        source: std::io::Error,
    },

    #[error("ATOL error {code}: {description}")]
    Atol { code: i32, description: String },

    #[error("ATOL create() failed with code {0}")]
    Create(i32),
}

// ── UTF-16 helpers ──

pub fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

pub fn from_wide(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

// ── Function pointer types (matching fptr10.h typedefs) ──

type CreateFn = unsafe extern "C" fn(*mut *mut std::ffi::c_void) -> i32;
type DestroyFn = unsafe extern "C" fn(*mut *mut std::ffi::c_void) -> i32;
type CommonFn = unsafe extern "C" fn(*mut std::ffi::c_void) -> i32;
type IsOpenedFn = unsafe extern "C" fn(*mut std::ffi::c_void) -> i32;
type ErrorCodeFn = unsafe extern "C" fn(*mut std::ffi::c_void) -> i32;
type ErrorDescFn = unsafe extern "C" fn(*mut std::ffi::c_void, *mut u16, i32) -> i32;
type SetSingleSettingFn = unsafe extern "C" fn(*mut std::ffi::c_void, *const u16, *const u16);
type SetParamIntFn = unsafe extern "C" fn(*mut std::ffi::c_void, i32, u32);
type SetParamStringFn = unsafe extern "C" fn(*mut std::ffi::c_void, i32, *const u16);
type GetParamIntFn = unsafe extern "C" fn(*mut std::ffi::c_void, i32) -> u32;
type GetParamStringFn = unsafe extern "C" fn(*mut std::ffi::c_void, i32, *mut u16, i32) -> i32;

// ── FptrLib — loaded DLL with function pointers ──

pub struct FptrLib {
    _handle: windows::Win32::Foundation::HMODULE,

    fn_create: CreateFn,
    fn_destroy: DestroyFn,
    fn_open: CommonFn,
    fn_close: CommonFn,
    fn_is_opened: IsOpenedFn,
    fn_apply_single_settings: CommonFn,
    fn_set_single_setting: SetSingleSettingFn,
    fn_set_param_int: SetParamIntFn,
    fn_set_param_string: SetParamStringFn,
    fn_get_param_int: GetParamIntFn,
    fn_get_param_string: GetParamStringFn,
    fn_query_data: CommonFn,
    fn_process_json: CommonFn,
    fn_read_device_setting: CommonFn,
    fn_write_device_setting: CommonFn,
    fn_error_code: ErrorCodeFn,
    fn_error_description: ErrorDescFn,
}

impl FptrLib {
    /// Load fptr10.dll and resolve all required function pointers.
    pub fn load(dll_path: &str) -> Result<Self, FptrError> {
        use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
        use windows::core::PCWSTR;

        info!(path = dll_path, "Loading ATOL fptr10.dll");

        let wide_path = to_wide(dll_path);
        let handle = unsafe { LoadLibraryW(PCWSTR(wide_path.as_ptr())) }.map_err(|e| {
            FptrError::LoadLibrary {
                path: dll_path.to_string(),
                source: std::io::Error::from_raw_os_error(e.code().0 as i32),
            }
        })?;

        macro_rules! load_fn {
            ($name:expr, $ty:ty) => {{
                let proc = unsafe { GetProcAddress(handle, windows::core::PCSTR($name.as_ptr())) };
                match proc {
                    Some(f) => unsafe { std::mem::transmute::<_, $ty>(f) },
                    None => {
                        return Err(FptrError::GetProcAddress {
                            func_name: String::from_utf8_lossy($name).to_string(),
                            source: std::io::Error::last_os_error(),
                        });
                    }
                }
            }};
        }

        let lib = Self {
            _handle: handle,
            fn_create: load_fn!(b"libfptr_create\0", CreateFn),
            fn_destroy: load_fn!(b"libfptr_destroy\0", DestroyFn),
            fn_open: load_fn!(b"libfptr_open\0", CommonFn),
            fn_close: load_fn!(b"libfptr_close\0", CommonFn),
            fn_is_opened: load_fn!(b"libfptr_is_opened\0", IsOpenedFn),
            fn_apply_single_settings: load_fn!(b"libfptr_apply_single_settings\0", CommonFn),
            fn_set_single_setting: load_fn!(b"libfptr_set_single_setting\0", SetSingleSettingFn),
            fn_set_param_int: load_fn!(b"libfptr_set_param_int\0", SetParamIntFn),
            fn_set_param_string: load_fn!(b"libfptr_set_param_str\0", SetParamStringFn),
            fn_get_param_int: load_fn!(b"libfptr_get_param_int\0", GetParamIntFn),
            fn_get_param_string: load_fn!(b"libfptr_get_param_str\0", GetParamStringFn),
            fn_query_data: load_fn!(b"libfptr_query_data\0", CommonFn),
            fn_process_json: load_fn!(b"libfptr_process_json\0", CommonFn),
            fn_read_device_setting: load_fn!(b"libfptr_read_device_setting\0", CommonFn),
            fn_write_device_setting: load_fn!(b"libfptr_write_device_setting\0", CommonFn),
            fn_error_code: load_fn!(b"libfptr_error_code\0", ErrorCodeFn),
            fn_error_description: load_fn!(b"libfptr_error_description\0", ErrorDescFn),
        };

        info!("ATOL fptr10.dll loaded successfully");
        Ok(lib)
    }

    // ── Safe wrappers ──

    pub fn create(&self) -> Result<*mut std::ffi::c_void, FptrError> {
        let mut handle: *mut std::ffi::c_void = std::ptr::null_mut();
        let rc = unsafe { (self.fn_create)(&mut handle) };
        if rc != 0 {
            return Err(FptrError::Create(rc));
        }
        debug!("ATOL fptr handle created");
        Ok(handle)
    }

    pub fn destroy(&self, handle: &mut *mut std::ffi::c_void) {
        unsafe { (self.fn_destroy)(handle) };
        debug!("ATOL fptr handle destroyed");
    }

    pub fn set_single_setting(&self, handle: *mut std::ffi::c_void, key: &str, value: &str) {
        let wkey = to_wide(key);
        let wval = to_wide(value);
        unsafe { (self.fn_set_single_setting)(handle, wkey.as_ptr(), wval.as_ptr()) };
    }

    pub fn apply_single_settings(&self, handle: *mut std::ffi::c_void) -> Result<(), FptrError> {
        let rc = unsafe { (self.fn_apply_single_settings)(handle) };
        if rc != 0 {
            return Err(self.get_error(handle));
        }
        Ok(())
    }

    pub fn open(&self, handle: *mut std::ffi::c_void) -> Result<(), FptrError> {
        let rc = unsafe { (self.fn_open)(handle) };
        if rc != 0 {
            return Err(self.get_error(handle));
        }
        Ok(())
    }

    pub fn close(&self, handle: *mut std::ffi::c_void) {
        unsafe { (self.fn_close)(handle) };
    }

    pub fn is_opened(&self, handle: *mut std::ffi::c_void) -> bool {
        unsafe { (self.fn_is_opened)(handle) != 0 }
    }

    pub fn set_param_string(&self, handle: *mut std::ffi::c_void, param_id: i32, value: &str) {
        let wval = to_wide(value);
        unsafe { (self.fn_set_param_string)(handle, param_id, wval.as_ptr()) };
    }

    pub fn set_param_int(&self, handle: *mut std::ffi::c_void, param_id: i32, value: i32) {
        unsafe { (self.fn_set_param_int)(handle, param_id, value as u32) };
    }

    pub fn get_param_int(&self, handle: *mut std::ffi::c_void, param_id: i32) -> i32 {
        unsafe { (self.fn_get_param_int)(handle, param_id) as i32 }
    }

    pub fn get_param_string(&self, handle: *mut std::ffi::c_void, param_id: i32) -> String {
        let mut buf = vec![0u16; 4096];
        let len = unsafe {
            (self.fn_get_param_string)(handle, param_id, buf.as_mut_ptr(), buf.len() as i32)
        };
        if len > 0 && (len as usize) < buf.len() {
            from_wide(&buf[..len as usize])
        } else {
            from_wide(&buf)
        }
    }

    pub fn query_data(&self, handle: *mut std::ffi::c_void) -> Result<(), FptrError> {
        let rc = unsafe { (self.fn_query_data)(handle) };
        if rc != 0 {
            return Err(self.get_error(handle));
        }
        Ok(())
    }

    pub fn process_json(&self, handle: *mut std::ffi::c_void) -> Result<(), FptrError> {
        let rc = unsafe { (self.fn_process_json)(handle) };
        if rc != 0 {
            return Err(self.get_error(handle));
        }
        Ok(())
    }

    pub fn read_device_setting(&self, handle: *mut std::ffi::c_void) -> Result<(), FptrError> {
        let rc = unsafe { (self.fn_read_device_setting)(handle) };
        if rc != 0 {
            return Err(self.get_error(handle));
        }
        Ok(())
    }

    pub fn write_device_setting(&self, handle: *mut std::ffi::c_void) -> Result<(), FptrError> {
        let rc = unsafe { (self.fn_write_device_setting)(handle) };
        if rc != 0 {
            return Err(self.get_error(handle));
        }
        Ok(())
    }

    pub fn error_code(&self, handle: *mut std::ffi::c_void) -> i32 {
        unsafe { (self.fn_error_code)(handle) }
    }

    pub fn error_description(&self, handle: *mut std::ffi::c_void) -> String {
        let mut buf = vec![0u16; 1024];
        unsafe { (self.fn_error_description)(handle, buf.as_mut_ptr(), buf.len() as i32) };
        from_wide(&buf)
    }

    fn get_error(&self, handle: *mut std::ffi::c_void) -> FptrError {
        FptrError::Atol {
            code: self.error_code(handle),
            description: self.error_description(handle),
        }
    }
}

impl Drop for FptrLib {
    fn drop(&mut self) {
        use windows::Win32::Foundation::FreeLibrary;
        unsafe {
            let _ = FreeLibrary(self._handle);
        }
        debug!("ATOL fptr10.dll unloaded");
    }
}

// FptrLib holds only function pointers and an HMODULE — safe to share across threads
// The actual device handle is protected by Mutex in AtolDevice (atol.rs)
unsafe impl Send for FptrLib {}
unsafe impl Sync for FptrLib {}
