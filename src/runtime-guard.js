export class FrameGuard {
  constructor(onError) {
    this.onError = onError;
    this.failed = false;
  }

  run(frame) {
    if (this.failed) return false;
    try {
      frame();
      return true;
    } catch (error) {
      this.failed = true;
      try { this.onError(error); } catch (handlerError) {
        console.error('frame error handler failed', handlerError, error);
      }
      return false;
    }
  }
}

export async function recoverableRestore(start, recover) {
  try {
    await start();
    return true;
  } catch (error) {
    await recover(error);
    return false;
  }
}
