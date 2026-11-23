import { Accounts } from '../server/accounts.js';
import { Store } from '../server/store.js';
const [action, value] = process.argv.slice(2);
const store = new Store(process.env.SQLITE_PATH || './data/game.sqlite');
try {
  const accounts = new Accounts(store.db);
  if (action === 'issue') console.log(accounts.issueInvite(Number(value || 168)));
  else if(action==='recover'&&value){
    const temporary=await accounts.adminRecover(value);
    console.log(`One-time recovery password for ${value}: ${temporary}`);
    console.log('Deliver it privately, then have the player sign in and change it. Existing sessions were revoked.');
  }
  else if (action === 'revoke' && value) {
    if (!accounts.revokeInvite(value)) { console.error('Invitation not found, already used or already revoked'); process.exitCode = 1; }
    else console.log('Invitation revoked');
  } else { console.error('Usage: npm run admin:invite -- issue [expiry-hours] | revoke <invite-code> | recover <login-id>'); process.exitCode = 2; }
} finally { store.close(); }
