use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn sanitize_id(id: &str) -> Result<String, String> {
    let id = id.trim().to_lowercase();
    if id.is_empty() || id.len() > 64 {
        return Err("id must be 1–64 chars".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("id must be alphanumeric, hyphen, or underscore".into());
    }
    Ok(id)
}

fn ensure_under(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("repo root: {e}"))?;
    let parent = candidate
        .parent()
        .ok_or_else(|| "invalid path".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    let parent = parent
        .canonicalize()
        .map_err(|e| format!("path parent: {e}"))?;
    if !parent.starts_with(&root) {
        return Err("refusing to write outside repository root".into());
    }
    Ok(candidate.to_path_buf())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteAgentArgs {
    repo_root: String,
    harness: String,
    id: String,
    name: String,
    description: String,
    capability_tags: String,
    body: String,
}

#[tauri::command]
fn write_agent(args: WriteAgentArgs) -> Result<String, String> {
    let id = sanitize_id(&args.id)?;
    let root = PathBuf::from(&args.repo_root);
    let (folder, file) = match args.harness.as_str() {
        "cursor" => (".cursor/agents", format!("{id}.md")),
        "claude" => (".claude/agents", format!("{id}.md")),
        "codex" => (".codex/agents", format!("{id}.toml")),
        "opencode" => (".opencode/agents", format!("{id}.md")),
        _ => return Err("harness must be cursor|claude|codex|opencode".into()),
    };
    let path = root.join(folder).join(&file);
    ensure_under(&root, &path)?;

    let content = if file.ends_with(".toml") {
        format!(
            "name = \"{id}\"\ndescription = \"{}\"\ncapabilityTags = \"{}\"\n\n{}\n",
            args.description.replace('"', "'"),
            args.capability_tags.replace('"', "'"),
            args.body.trim()
        )
    } else {
        format!(
            "---\nname: {id}\ndescription: {}\ncapabilityTags: {}\n---\n\n# {}\n\n{}\n",
            args.description.replace('\n', " "),
            args.capability_tags.replace('\n', " "),
            args.name.trim(),
            args.body.trim()
        )
    };

    fs::write(&path, content).map_err(|e| format!("write: {e}"))?;
    Ok(path.display().to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteSkillArgs {
    repo_root: String,
    id: String,
    name: String,
    description: String,
    body: String,
}

#[tauri::command]
fn write_skill(args: WriteSkillArgs) -> Result<String, String> {
    let id = sanitize_id(&args.id)?;
    let root = PathBuf::from(&args.repo_root);
    let path = root.join("skills").join(&id).join("SKILL.md");
    ensure_under(&root, &path)?;
    let content = format!(
        "---\nname: {id}\ndescription: {}\n---\n\n# {}\n\n{}\n",
        args.description.replace('\n', " "),
        args.name.trim(),
        args.body.trim()
    );
    fs::write(&path, content).map_err(|e| format!("write: {e}"))?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn run_superspec(repo_root: String, bin_rel: String, args: Vec<String>) -> Result<String, String> {
    let root = PathBuf::from(&repo_root)
        .canonicalize()
        .map_err(|e| format!("repo: {e}"))?;
    let bin = root.join(&bin_rel);
    if !bin.starts_with(&root) {
        return Err("superspec bin outside repo".into());
    }
    let output = Command::new("node")
        .arg(&bin)
        .args(&args)
        .current_dir(&root)
        .output()
        .map_err(|e| format!("spawn: {e}"))?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        text.push_str("\n");
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    if !output.status.success() {
        return Err(format!("exit {}: {text}", output.status));
    }
    Ok(text)
}

#[tauri::command]
fn detect_engines(repo_root: String) -> Result<String, String> {
    let bins = [
        ("claude", "claude"),
        ("cursor-agent", "cursor-agent"),
        ("codex", "codex"),
        ("opencode", "opencode"),
    ];
    let mut rows = Vec::new();
    for (id, cmd) in bins {
        let ok = Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        rows.push(format!(
            r#"{{"id":"{id}","cmd":"{cmd}","installed":{ok},"hostSpawnOnly":{}}}"#,
            if id == "opencode" { "false" } else { "true" }
        ));
    }
    let _ = repo_root;
    Ok(format!(r#"{{"engines":[{}],"note":"which-detect; host engines never Ira-parented"}}"#, rows.join(",")))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            write_agent,
            write_skill,
            run_superspec,
            detect_engines
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
