// Localhost proof driver. Not a menu, and not available on the production host.
// It fills the real party screen from the party rules, then runs the real
// renderer one fixed step at a time.

import { createPartyState, addMember, canStart, inviteLink, pressureLabel, profileCard, setReady } from '../src/party.js';

const LEADER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FRIEND = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function partyView() {
  const party = createPartyState({
    id: 'preview', code: 'FRIEND', leaderId: LEADER, leaderName: 'ada', hero: 'scott', levelId: 1,
  });
  addMember(party, { userId: FRIEND, name: 'bea', hero: 'alexander' });
  setReady(party, FRIEND, true);
  return {
    signedIn: true,
    empty: false,
    code: party.code,
    link: inviteLink('https://zillions.taborlin.co', party.code),
    leader: true,
    meName: 'ada',
    status: 'together',
    levelId: party.levelId,
    mode: party.mode,
    difficulty: party.difficulty,
    pressure: pressureLabel(party.members.length),
    canStart: canStart(party, LEADER),
    myHero: 'scott',
    myReady: false,
    taken: party.members.map((member) => member.hero),
    members: party.members.map((member) => ({
      ...member,
      leader: member.userId === party.leaderId,
      you: member.userId === LEADER,
    })),
  };
}

export async function runPartyPreview(app) {
  const view = partyView();
  app.ui._accountAccepted = true;
  app.ui.showParty(view);
  app.ui.lobbyFriends([
    { id: 'f1', userId: FRIEND, name: 'bea', status: 'accepted', online: true, presence: 'online', direction: 'incoming' },
    { id: 'f2', userId: LEADER, name: 'cy', status: 'accepted', online: true, presence: 'in_match', direction: 'incoming' },
    { id: 'f3', userId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', name: 'dee', status: 'pending', direction: 'incoming' },
  ]);
  app.ui.partyChatFill([
    { id: 'c1', user_id: FRIEND, name: 'bea', text: 'On my way. I will take the east gate.', created_at: new Date().toISOString() },
    { id: 'c2', user_id: LEADER, name: 'ada', text: 'Shared gold. I will found the keep.', created_at: new Date().toISOString() },
  ]);
  app.ui.showProfile(profileCard({
    id: FRIEND, handle: 'bea', selected_hero: 'alexander', favorite_hero: 'alexander',
    level: 6, games_played: 11, wins: 4, campaign_cleared: 2,
  }), { muted: false, blocked: false, self: false });

  window.__partyPreview = {
    async show(stage) {
      app.ui.showProfile(null);
      if (stage === 'invite') {
        app.ui.showParty({ signedIn: true, empty: true, meName: 'ada' });
        app.ui.partyChatFill([]);
      } else if (stage === 'lobby') {
        app.ui.showParty(view);
        app.ui.showProfile(null);
      } else if (stage === 'friends') {
        app.ui.showParty(view);
        app.ui.showProfile(null);
      } else if (stage === 'chat') {
        app.ui.showParty(view);
        app.ui.showProfile(null);
      } else if (stage === 'profile') {
        app.ui.showParty(view);
        app.ui.showProfile(profileCard({
          id: FRIEND, handle: 'bea', selected_hero: 'alexander', favorite_hero: 'scott',
          level: 6, games_played: 11, wins: 4, campaign_cleared: 2,
        }), { self: false });
      }
      const panel = document.querySelector('#screen-party');
      if (panel) panel.scrollTop = stage === 'chat' ? panel.scrollHeight : 0;
      window.__partyStage = stage;
    },
    async battle() {
      app.ui.showProfile(null);
      app.ui.hideStart();
      await app.startGame('normal', null, {
        role: 'local',
        heroes: [{ k: 'scott' }, { k: 'alexander' }],
        names: ['ada', 'bea'],
        myPlayer: 0,
        level: 1,
        mode: 'campaign',
        culture: 'crown',
      });
      app.paused = true;
      app._captureHold = true;
      app._scriptHeroes = true;
      app.controlMode = 'fight';
      app.ui.setControlMode('fight');
      app.camDist = 58;
      app.game.exec({ t: 'found', s: 0, p: 0 });
      if (app.game.firstSiege) app.game.firstSiege.stage = 'complete';
      for (const other of app.game.nests) other.musterT = 80;
      // One readable wave just outside the keep. The full frontier scatter
      // would fill the frame with strays and stall the capture.
      const home = app.game.hq || { cx: 100, cz: 100 };
      app.game.zombies = [];
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        app.game._spawnZombie('walker', home.cx + Math.cos(angle) * 16, home.cz + Math.sin(angle) * 12, true);
      }
      app.ui.setGameChatEnabled(true);
      app.ui.gameChatFill([
        { id: 'g1', user_id: FRIEND, name: 'bea', text: 'Wave on the gate. I have the right.', created_at: new Date().toISOString() },
      ]);
      for (let i = 0; i < 15; i++) this.step(1 / 30);
      window.__partyStage = 'battle';
    },
    step(dt = 1 / 30) {
      const game = app.game;
      if (!game) return;
      const living = game.zombies.filter((zombie) => !zombie.dead);
      game.heroes.forEach((hero, index) => {
        let nearest = null;
        let nearestD = Infinity;
        for (const zombie of living) {
          const d = (zombie.x - hero.x) ** 2 + (zombie.z - hero.z) ** 2;
          if (d < nearestD) { nearestD = d; nearest = zombie; }
        }
        if (hero.dead || !nearest) {
          game.exec({ t: 'hdir', p: index, x: 0, z: 0 });
          return;
        }
        const dx = nearest.x - hero.x;
        const dz = nearest.z - hero.z;
        const len = Math.hypot(dx, dz) || 1;
        const side = index === 0 ? 0.35 : -0.35;
        game.exec({ t: 'hdir', p: index, x: (dx / len) + side, z: dz / len });
      });
      const a = game.heroes[0];
      const b = game.heroes[1] || a;
      const wobble = 0.5 + 0.5 * Math.sin((app._captureT || 0) * 0.45);
      app.cameraAim = {
        x: a.x + (b.x - a.x) * wobble,
        z: a.z + (b.z - a.z) * wobble,
        mx: 0,
        mz: 0,
      };
      app.shake = 0;
      app._captureHold = true;
      app._captureDt = dt;
      app.frame();
      app._captureHold = true;
    },
  };
  window.__partyStage = 'ready';
}
