// Android release builds refuse plain http. The app talks to the dealership over https, and that
// stays the only way to reach a real server. This allows http for the phone's own loopback
// addresses only (localhost, 127.0.0.1, and the emulator's 10.0.2.2), which never leave the device:
// it lets a developer test a release build against a server forwarded over USB (adb reverse).
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`;

module.exports = function withLocalCleartext(config) {
  config = withDangerousMod(config, [
    "android",
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "network_security_config.xml"), XML);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return c;
  });
};
module.exports.XML = XML;
