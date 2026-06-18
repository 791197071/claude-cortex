//! 通用文件读写命令。
//!
//! 前端各页（记忆编辑、CLAUDE.md 编辑、规则编辑等）共用这一组原子操作。
//! 路径由前端给出绝对路径，这里只做最薄的一层包装并把 IO 错误转成字符串返回。

use std::fs;
use std::path::Path;

/// 读取文本文件内容。
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 写入（覆盖）文本文件内容。
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 删除文件或目录。
#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}
