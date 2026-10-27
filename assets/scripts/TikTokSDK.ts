// TikTok Minis platform wrapper (login, rewarded / interstitial ads, home-screen shortcut, profile-sidebar revisit).
// Inside the TikTok runtime the APIs live on TTMinis.game (the docs say `tt` and `wx` are the same object), so the
// Cocos "bytedance-mini-game" build runs there unchanged. Anywhere else (browser, phone web build, editor) every
// call is simulated so game flows and UI can be built and tested before a real device.
// Docs: developers.tiktok.com/docs/en/in-app-ads, /mini-games-sdk-iaa, /silent-login, /mini-games-sdk-revisit-incentives
// Required by `ttmg check` before review: login, createRewardedVideoAd, addShortcut, getShortcutMissionReward,
// startEntranceMission, getEntranceMissionReward.

// Ad unit ids come from the Developer Portal (Monetization -> ad placement, set to Active). Empty = simulated ads.
export const TT_CONFIG = {
  rewardedAdUnitId: '',
  interstitialAdUnitId: '',
  simulatedAdSeconds: 1.5,   // how long a fake ad "plays" outside TikTok
};

type Cb = { success?: (r?: any) => void; fail?: (e?: any) => void; complete?: () => void };

function api(): any {
  const g: any = globalThis as any;
  return (g.TTMinis && g.TTMinis.game) || g.tt || null;
}
const wait = (s: number) => new Promise<void>(r => setTimeout(r, s * 1000));
// callback-style platform call -> Promise; resolves null when the API is missing or fails
function call<T = any>(name: string, extra: any = {}): Promise<T | null> {
  const a = api();
  if (!a || typeof a[name] !== 'function') return Promise.resolve(null);
  return new Promise(res => {
    const o: Cb = { ...extra, success: (r: any) => res(r ?? ({} as any)), fail: (e: any) => { log(name + ' fail', e); res(null); } };
    try { a[name](o); } catch (e) { log(name + ' threw', e); res(null); }
  });
}

export const ttLog: string[] = [];
function log(...m: any[]) {
  const s = m.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ');
  ttLog.push(s); if (ttLog.length > 30) ttLog.shift();
  console.log('[tiktok]', s);
}

let rewarded: any = null, interstitial: any = null;
let rewardedWaiter: ((ok: boolean) => void) | null = null;

export const TikTok = {
  /** true inside the TikTok app runtime (real ads / login); false = simulated */
  get real() { return !!api(); },

  /** silent login: returns the temporary `code` (a game server must exchange it for open_id; never in the client) */
  async login(): Promise<string | null> {
    if (!api()) { log('login (simulated)'); return 'sim-code'; }
    const r = await call<{ code: string }>('login');
    log('login', r ? 'ok' : 'failed');
    return r ? r.code : null;
  },

  /** Plays a rewarded video. Resolves true only when the player watched to the end (grant the reward then). */
  async showRewarded(placement = ''): Promise<boolean> {
    const a = api();
    if (!a || !TT_CONFIG.rewardedAdUnitId) { log('rewarded (simulated)', placement); await wait(TT_CONFIG.simulatedAdSeconds); return true; }
    if (!rewarded) {
      rewarded = a.createRewardedVideoAd({ adUnitId: TT_CONFIG.rewardedAdUnitId });
      rewarded.onClose((r: any) => { const ok = !r || r.isEnded !== false; log('rewarded close', ok); const w = rewardedWaiter; rewardedWaiter = null; if (w) w(ok); });
      rewarded.onError((e: any) => { log('rewarded error', e); const w = rewardedWaiter; rewardedWaiter = null; if (w) w(false); });
    }
    if (rewardedWaiter) return false;   // one ad at a time
    const done = new Promise<boolean>(r => { rewardedWaiter = r; });
    try { await rewarded.show(); }
    catch (e) {   // not loaded yet / no fill: load once and retry
      try { await rewarded.load(); await rewarded.show(); }
      catch (e2) { log('rewarded no fill', placement); const w = rewardedWaiter; rewardedWaiter = null; if (w) w(false); }
    }
    return done;
  },

  /** Interstitial between levels (never on the first level). Resolves when closed or failed. */
  async showInterstitial(): Promise<void> {
    const a = api();
    if (!a || !TT_CONFIG.interstitialAdUnitId || typeof a.createInterstitialAd !== 'function') { log('interstitial (simulated)'); return; }
    if (!interstitial) interstitial = a.createInterstitialAd({ adUnitId: TT_CONFIG.interstitialAdUnitId });
    try { await interstitial.show(); } catch (e) { log('interstitial failed', e); }
  },

  /** home-screen shortcut prompt (mandatory integration) */
  async addShortcut(): Promise<boolean> {
    if (!api()) { log('addShortcut (simulated)'); return true; }
    return !!(await call('addShortcut'));
  },
  /** true when the add-to-home-screen reward can be claimed */
  async shortcutReward(): Promise<boolean> {
    if (!api()) return false;
    const r = await call<{ canReceiveReward: boolean }>('getShortcutMissionReward');
    return !!(r && r.canReceiveReward);
  },
  /** jump to the TikTok profile sidebar (revisit task) */
  async startEntranceMission(): Promise<boolean> {
    if (!api()) { log('startEntranceMission (simulated)'); return true; }
    return !!(await call('startEntranceMission'));
  },
  /** true when the sidebar revisit reward can be claimed */
  async entranceReward(): Promise<boolean> {
    if (!api()) return false;
    const r = await call<{ canReceiveReward: boolean }>('getEntranceMissionReward');
    return !!(r && r.canReceiveReward);
  },
};
(globalThis as any).TikTok = TikTok;   // reachable from the dev console / tests
