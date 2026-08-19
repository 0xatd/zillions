export const SHELL_BASES = Object.freeze({
  AUTH: 'account',
  CHARACTER_SELECT: 'main',
  OVERWORLD: 'overworld',
  MISSION: 'mission',
});

const BASE_SCREENS = new Set(Object.values(SHELL_BASES));

// One source of truth for where the player is and which temporary view is
// covering it. Menus never become destinations: closing one always reveals
// the base state that opened it.
export class ShellState {
  constructor() {
    this.base = SHELL_BASES.AUTH;
    this.overlay = null;
    this.returnOverlay = null;
    this.missionReturn = null;
  }

  enterBase(base) {
    if (!BASE_SCREENS.has(base)) throw new Error(`invalid_shell_base:${base}`);
    this.base = base;
    this.overlay = null;
    this.returnOverlay = null;
    return this.snapshot();
  }

  openOverlay(name) {
    if (!name) throw new Error(`invalid_shell_overlay:${name}`);
    this.returnOverlay = this.overlay;
    this.overlay = name;
    return this.snapshot();
  }

  closeOverlay() {
    this.overlay = this.returnOverlay;
    this.returnOverlay = null;
    return this.snapshot();
  }

  enterMission(returnPoint) {
    this.missionReturn = returnPoint ? { ...returnPoint } : null;
    return this.enterBase(SHELL_BASES.MISSION);
  }

  finishMission() {
    const returnPoint = this.missionReturn ? { ...this.missionReturn } : null;
    this.missionReturn = null;
    this.enterBase(SHELL_BASES.OVERWORLD);
    return returnPoint;
  }

  snapshot() {
    return { base: this.base, overlay: this.overlay, returnOverlay: this.returnOverlay };
  }
}
