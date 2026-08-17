use std::process::Command;
use std::path::Path;

pub fn launch_instance(
    path: &Path,
    java: &str,
    classpath: &str,
    natives: &str,
    assets_dir: &str,
    assets_index: &str,
    username: &str,
    uuid: &str,
    token: &str,
    version: &str,
) -> Result<(), String> {

    let jar = path.join("client.jar");

    if !jar.exists() {
        return Err("No se encontró client.jar".into());
    }

    Command::new(java)
        .current_dir(path)
        .arg("-Xmx2G")
        .arg(format!("-Djava.library.path={}", natives))
        .arg("-cp")
        .arg(classpath)
        .arg("net.minecraft.client.main.Main")
        .arg("--gameDir")
        .arg(path)
        .arg("--assetsDir")
        .arg(assets_dir)
        .arg("--assetsIndex")
        .arg(assets_index)
        .arg("--username")
        .arg(username)
        .arg("--uuid")
        .arg(uuid)
        .arg("--accessToken")
        .arg(token)
        .arg("--userType")
        .arg("msa")
        .arg("--version")
        .arg(version)
        .spawn()
        .map_err(|e| format!("Error lanzando Java: {}", e))?;

    Ok(())
}