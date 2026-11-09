import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../dist/server/store.js';
import { blocked, clearPath, clientSchema, profileSchema } from '../dist/server/protocol.js';
import { missions } from '../dist/server/catalog.js';

test('finite bounded movement and name/profile schema', () => {
  assert.equal(blocked(0,8.5), false);
  assert.equal(blocked(Infinity,0), true);
  assert.equal(blocked(24,0), true);
  assert.equal(clearPath({ x:0,z:8.5 }, { x:0,z:12 }), false);
  assert.equal(clientSchema.safeParse({ type:'move',seq:1,x:NaN,z:0,yaw:0 }).success, false);
  assert.equal(clientSchema.safeParse({ type:'move',seq:1,x:0,z:8.5,yaw:0,xp:9999 }).success, false);
  assert.equal(profileSchema.safeParse({ name:'Nguyễn An',disc:'battery' }).success, true);
  assert.equal(profileSchema.safeParse({ name:'<script>',disc:'battery' }).success, false);
});
test('guest, best results, discipline bonus, mock isolation and idempotency', () => {
  const store = new Store(':memory:');
  try {
    const { guest:empty, token } = store.createGuest();
    const guest = store.profile(empty,'Test','powertrain');
    assert.equal(store.guest(token).id, guest.id);
    assert.equal(store.guest('forged'), undefined);
    const mission = missions.get('dyno');
    const review = { score:100,items:[],summary:'test',words:100,short:false,verified:false,provider:'mock',model:'mock',tokens:0 };
    store.commit(guest,mission,'mock','hash',review);
    assert.equal(store.progress(guest.id).xp,0);
    assert.equal(store.cached(guest.id,'real','dyno','hash'),undefined);
    store.commit(guest,mission,'real','hash2',{ ...review,verified:true });
    assert.equal(store.progress(guest.id).xp,180);
    store.commit(guest,mission,'live-after-mock','hash',{...review,verified:true});
    assert.equal(store.progress(guest.id).xp,180);
    store.commit(guest,mission,'repeat','hash2',{ ...review,verified:true });
    assert.equal(store.progress(guest.id).xp,180);
    assert.throws(()=>store.cached(guest.id,'repeat','onboard','other'));
    store.commit(guest,mission,'lower','hash3',{...review,score:60,verified:true});
    assert.equal(store.progress(guest.id).xp,180);
    assert.equal(store.quota('user',1,60000),true);
    assert.equal(store.quota('user',1,60000),false);
    assert.equal(store.reserve(2000,.01,3000,1),true);
    assert.equal(store.reserve(2000,.01,3000,1),false);
  } finally { store.close(); }
});