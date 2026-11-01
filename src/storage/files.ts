import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

export class FileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  pathFor(userId: string, storageName: string) {
    const directory = path.join(this.root, userId);
    mkdirSync(directory, { recursive: true });
    const fullPath = path.resolve(directory, storageName);
    if (!fullPath.startsWith(path.resolve(directory))) throw new Error("Invalid attachment path.");
    return fullPath;
  }

  async write(userId: string, storageName: string, bytes: Uint8Array) {
    const filePath = this.pathFor(userId, storageName);
    writeFileSync(filePath, bytes);
    return filePath;
  }

  async read(userId: string, storageName: string) {
    const filePath = this.pathFor(userId, storageName);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath);
  }

  async remove(userId: string, storageName: string) {
    const filePath = this.pathFor(userId, storageName);
    if (existsSync(filePath)) rmSync(filePath);
  }

  async removeUser(userId: string) {
    const directory = path.join(this.root, userId);
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
  }
}
