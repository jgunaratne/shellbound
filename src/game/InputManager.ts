export class InputManager {
  private keys: Set<string> = new Set();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private _pointerLocked = false;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    this.onClick = this.onClick.bind(this);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    canvas.addEventListener('click', this.onClick);
  }

  private onClick() {
    this.canvas.requestPointerLock();
  }

  private onPointerLockChange() {
    this._pointerLocked = document.pointerLockElement === this.canvas;
  }

  private onKeyDown(e: KeyboardEvent) {
    this.keys.add(e.code);
    if (['Space','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
  }

  private onMouseMove(e: MouseEvent) {
    if (this._pointerLocked) {
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    }
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  consumeMouseDelta(): { x: number; y: number } {
    const d = { x: this.mouseDeltaX, y: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return d;
  }

  get pointerLocked(): boolean {
    return this._pointerLocked;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('click', this.onClick);
  }
}
