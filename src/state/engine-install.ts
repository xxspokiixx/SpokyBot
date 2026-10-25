// What the server says about installing an engine on the machine it runs on.

export interface EngineInstall {
  platform?: "darwin" | "win32" | "linux";
  command?: Partial<Record<"darwin" | "win32" | "linux", string>>;
  docsUrl?: string;
  signInCommand?: string;
  needsNode?: boolean;
  managed?: { label: string; downloadBytes: number };
  server?: { package?: string; standalone?: { version: string; downloadBytes: number } };
  settings?: "connections";
  /** The CLI runs the copy OpenMausBot installed, which the person's terminal does not reach: set up in the app, not there. */
  appCopy?: boolean;
}
