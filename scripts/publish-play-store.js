/**
 * Publicador Automático de Google Play Console (Mobile + Wear OS)
 * Sube y publica automáticamente los paquetes .aab en:
 *  - Celular (internal / alpha - Prueba cerrada)
 *  - Wear OS (wear:internal / wear:alpha - Prueba cerrada de reloj)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PACKAGE_NAME = 'com.archery101010.app';
const SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_PLAY_KEY_FILE ||
  path.join(__dirname, '..', 'play-service-account.json');

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = signer
    .sign(serviceAccount.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Error OAuth Google Play: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function uploadBundleAndAssignTrack(token, editId, aabPath, tracks, releaseName) {
  const aabBuffer = fs.readFileSync(aabPath);
  console.log(`📦 Subiendo ${path.basename(aabPath)} (${(aabBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);

  const uploadRes = await fetch(
    `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}/bundles?uploadType=media`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: aabBuffer,
    }
  );
  const bundleData = await uploadRes.json();
  if (!uploadRes.ok) {
    throw new Error(`Error subiendo ${path.basename(aabPath)}: ${JSON.stringify(bundleData)}`);
  }
  const versionCode = bundleData.versionCode;
  console.log(`✅ Paquete registrado con versionCode: ${versionCode}`);

  for (const track of tracks) {
    console.log(`🚀 Asignando ${versionCode} al canal [${track}]...`);
    const trackRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}/tracks/${encodeURIComponent(track)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          track,
          releases: [
            {
              name: releaseName,
              versionCodes: [String(versionCode)],
              status: 'completed',
              releaseNotes: [
                {
                  language: 'es-419',
                  text: `Actualización automática ${releaseName} (Mobile + Wear OS sincronizados).`,
                },
              ],
            },
          ],
        }),
      }
    );
    const trackData = await trackRes.json();
    if (!trackRes.ok) {
      console.warn(`⚠️ Aviso en canal ${track}: ${JSON.stringify(trackData)}`);
    } else {
      console.log(`✅ Canal [${track}] actualizado con versión ${versionCode}.`);
    }
  }
}

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(
      `⚠️ Falta el archivo de llave de servicio: ${SERVICE_ACCOUNT_PATH}\n` +
        `Coloca tu JSON de cuenta de servicio como 'play-service-account.json' en la raíz del proyecto.`
    );
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const shortVer = pkg.version.split('.').slice(0, 2).join('.');
  const mobileAab = path.join(
    __dirname,
    '..',
    'android',
    'app',
    'build',
    'outputs',
    'bundle',
    'release',
    'app-release.aab'
  );
  const wearAab = path.join(
    __dirname,
    '..',
    'android',
    'wear',
    'build',
    'outputs',
    'bundle',
    'release',
    'wear-release.aab'
  );

  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  const token = await getAccessToken(serviceAccount);

  const editRes = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  const editData = await editRes.json();
  if (!editRes.ok) {
    throw new Error(`No se pudo iniciar edición en Play Console: ${JSON.stringify(editData)}`);
  }
  const editId = editData.id;

  if (fs.existsSync(mobileAab)) {
    await uploadBundleAndAssignTrack(token, editId, mobileAab, ['internal', 'alpha'], `v${shortVer}`);
  }
  if (fs.existsSync(wearAab)) {
    await uploadBundleAndAssignTrack(
      token,
      editId,
      wearAab,
      ['wear:internal', 'wear:alpha'],
      `v${shortVer} (Wear OS)`
    );
  }

  const commitRes = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/edits/${editId}:commit`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const commitData = await commitRes.json();
  if (!commitRes.ok) {
    throw new Error(`Error al confirmar publicación: ${JSON.stringify(commitData)}`);
  }
  console.log(`🎉 ¡Publicación automática completada en Google Play Console! (Edit ID: ${commitData.id})`);
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
