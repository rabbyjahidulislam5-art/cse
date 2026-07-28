import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import { URL } from 'url';

// One-time local script — not deployed, not imported by index.ts. Run it once to mint the
// GMAIL_OAUTH_REFRESH_TOKEN used by src/lib/email.ts, then discard/rerun only if that token is
// ever revoked. Requires a Google Cloud OAuth 2.0 Client ID of type "Desktop app" — Desktop
// clients support this localhost-loopback flow without pre-registering the exact redirect port.
const [CLIENT_ID, CLIENT_SECRET] = process.argv.slice(2);
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Usage: npx tsx src/get-gmail-token.ts <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/gmail.send'],
});

console.log('\nOpen this URL, sign in with the Gmail account you want OTP emails to be sent FROM, and approve access:\n');
console.log(authUrl + '\n');

const server = http.createServer(async (req, res) => {
  if (!req.url) return;
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== '/oauth2callback') {
    res.end();
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.end('Google returned an error — check the terminal.');
    console.error(`Google denied the request: ${error}`);
    server.close();
    return;
  }
  if (!code) {
    res.end('No authorization code received — check the terminal.');
    console.error('Callback had no ?code= param:', req.url);
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end('Success — you can close this tab and return to the terminal.');
    if (!tokens.refresh_token) {
      console.error('\nGoogle did not return a refresh_token. This happens if this Gmail account already granted this exact app consent before — go to https://myaccount.google.com/permissions, remove access for this app, and run this script again.\n');
      server.close();
      return;
    }

    console.log('\nGMAIL_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token + '\n');

    // Verify the refresh token actually works standalone — a fresh OAuth2Client with ONLY the
    // client id/secret/refresh_token, exactly what the deployed server will construct from env
    // vars. This confirms the token independently of the code-exchange step above.
    console.log('Verifying the refresh token works on its own (simulating the deployed server)...');
    const verifyClient = new OAuth2Client(CLIENT_ID, CLIENT_SECRET);
    verifyClient.setCredentials({ refresh_token: tokens.refresh_token });
    const { token: accessToken } = await verifyClient.getAccessToken();
    if (!accessToken) throw new Error('getAccessToken() returned no token');
    console.log('VERIFIED: refresh token successfully minted a fresh Gmail API access token.\n');
  } catch (err: any) {
    res.end('Token exchange or verification failed — check the terminal.');
    console.error('FAILED:', err.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log(`Waiting for the OAuth callback on ${REDIRECT_URI} ...\n`);
});
