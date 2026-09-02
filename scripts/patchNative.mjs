/**
 * Patch Android après cap add / cap sync : ID AdMob dans le manifeste.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ANDROID_APP_ID = "ca-app-pub-6332424645114129~3377348623";
const ANDROID_APPLICATION_ID = "com.havefuncorp.aura";

function patchAndroid() {
  const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
  const stringsPath = path.join(root, "android", "app", "src", "main", "res", "values", "strings.xml");
  const gradlePath = path.join(root, "android", "app", "build.gradle");

  if (!fs.existsSync(manifestPath)) {
    console.log("Android: AndroidManifest.xml absent — skip");
    return;
  }

  let manifest = fs.readFileSync(manifestPath, "utf8");
  if (!manifest.includes("com.google.android.gms.ads.APPLICATION_ID")) {
    const meta = `
        <meta-data
            android:name="com.google.android.gms.ads.APPLICATION_ID"
            android:value="@string/admob_app_id"/>`;
    manifest = manifest.replace("</application>", `${meta}\n    </application>`);
    fs.writeFileSync(manifestPath, manifest);
    console.log("Android: meta-data AdMob ajouté");
  }

  if (fs.existsSync(gradlePath)) {
    const gradle = fs.readFileSync(gradlePath, "utf8");
    const match = gradle.match(/applicationId\s+"([^"]+)"/);
    const applicationId = match && match[1];
    if (applicationId !== ANDROID_APPLICATION_ID) {
      throw new Error(
        `Android applicationId doit rester ${ANDROID_APPLICATION_ID} (trouvé: ${applicationId || "absent"})`
      );
    }
  }

  const settingsPath = path.join(root, "android", "settings.gradle");
  if (fs.existsSync(settingsPath)) {
    let settings = fs.readFileSync(settingsPath, "utf8");
    const next = settings.replace(
      /plugins\s*\{\s*id\s+'org\.gradle\.toolchains\.foojay-resolver-convention'\s+version\s+'[^']+'\s*\}\s*/g,
      ""
    );
    if (next !== settings) {
      fs.writeFileSync(settingsPath, next);
      console.log("Android: plugin foojay retiré de settings.gradle");
    }
  }

  if (fs.existsSync(stringsPath)) {
    let strings = fs.readFileSync(stringsPath, "utf8");
    if (!strings.includes("admob_app_id")) {
      strings = strings.replace(
        "</resources>",
        `    <string name="admob_app_id">${ANDROID_APP_ID}</string>\n</resources>`
      );
      fs.writeFileSync(stringsPath, strings);
      console.log("Android: admob_app_id ajouté dans strings.xml");
    }
  }
}

patchAndroid();
