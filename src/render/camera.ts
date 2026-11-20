import { MAP_HEIGHT, MAP_WIDTH, Point2D } from '../engine/types';

export class Camera {
  public offsetX = 0;
  public offsetY = 0;
  public zoom = 3;

  private readonly minZoom = 1.4;
  private readonly maxZoom = 20;

  public fitToScreen(
    viewportWidth: number,
    viewportHeight: number,
    mapWidth = MAP_WIDTH,
    mapHeight = MAP_HEIGHT,
  ): void {
    const padX = 32;
    const padY = 128; // leave breathing room for top and bottom HUD bars
    const availW = Math.max(200, viewportWidth - padX);
    const availH = Math.max(200, viewportHeight - padY);
    const fitZoom = Math.min(availW / mapWidth, availH / mapHeight);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, fitZoom));
    this.offsetX = (viewportWidth - mapWidth * this.zoom) * 0.5;
    this.offsetY = (viewportHeight - mapHeight * this.zoom) * 0.5;
  }

  public pan(dxScreen: number, dyScreen: number): void {
    this.offsetX += dxScreen;
    this.offsetY += dyScreen;
  }

  public clampToViewport(
    viewportWidth: number,
    viewportHeight: number,
    mapWidth = MAP_WIDTH,
    mapHeight = MAP_HEIGHT,
  ): void {
    const mapPixelW = mapWidth * this.zoom;
    const mapPixelH = mapHeight * this.zoom;
    const margin = 80;
    const minOffsetX = margin - mapPixelW;
    const maxOffsetX = viewportWidth - margin;
    const minOffsetY = margin - mapPixelH;
    const maxOffsetY = viewportHeight - margin;
    this.offsetX = Math.max(minOffsetX, Math.min(maxOffsetX, this.offsetX));
    this.offsetY = Math.max(minOffsetY, Math.min(maxOffsetY, this.offsetY));
  }

  public zoomAtScreenPoint(factor: number, screenX: number, screenY: number): void {
    const worldBefore = this.screenToWorld(screenX, screenY);
    const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    this.zoom = nextZoom;
    this.offsetX = screenX - worldBefore.x * this.zoom;
    this.offsetY = screenY - worldBefore.y * this.zoom;
  }

  public screenToWorld(screenX: number, screenY: number): Point2D {
    return {
      x: (screenX - this.offsetX) / this.zoom,
      y: (screenY - this.offsetY) / this.zoom,
    };
  }

  public worldToScreen(worldX: number, worldY: number): Point2D {
    return {
      x: worldX * this.zoom + this.offsetX,
      y: worldY * this.zoom + this.offsetY,
    };
  }

  public updateKeyboardPan(
    keysPressed: ReadonlySet<string>,
    dtSec: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    let vx = 0;
    let vy = 0;
    if (keysPressed.has('KeyA')) vx += 1;
    if (keysPressed.has('KeyD')) vx -= 1;
    if (keysPressed.has('KeyW')) vy += 1;
    if (keysPressed.has('KeyS')) vy -= 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      const panSpeed = 540 * dtSec;
      this.pan((vx / len) * panSpeed, (vy / len) * panSpeed);
      this.clampToViewport(viewportWidth, viewportHeight);
    }
  }
}
