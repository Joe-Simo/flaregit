import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Task } from "../core/types.js";

export interface AgentAction {
  type: "read_file" | "write_file" | "commit" | "push";
  path?: string;
  content?: string;
  message?: string;
}

export interface AgentExecutionLog {
  action: AgentAction;
  timestamp: string;
  success: boolean;
  output?: string;
}

export class RuntimeCodingAgent {
  public readonly id: string;
  public readonly name: string;
  public readonly task: Task;
  public readonly workspacePath: string;
  public readonly executionLogs: AgentExecutionLog[] = [];

  constructor(task: Task) {
    this.id = task.contributor.id;
    this.name = task.contributor.name;
    this.task = task;
    const ws = task.workspace.localPath;
    if (!ws) throw new Error(`Task ${task.id} has no local workspace path`);
    this.workspacePath = ws;
  }

  readFile(relativePath: string): string {
    const fullPath = path.join(this.workspacePath, relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${relativePath}`);
    }
    const content = fs.readFileSync(fullPath, "utf-8");
    this.executionLogs.push({
      action: { type: "read_file", path: relativePath },
      timestamp: new Date().toISOString(),
      success: true,
      output: `Read ${content.length} characters`,
    });
    return content;
  }

  writeFile(relativePath: string, content: string): void {
    const fullPath = path.join(this.workspacePath, relativePath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf-8");
    this.executionLogs.push({
      action: { type: "write_file", path: relativePath, content },
      timestamp: new Date().toISOString(),
      success: true,
      output: `Wrote ${content.length} characters to ${relativePath}`,
    });
  }

  commit(message: string, allowEmpty: boolean = true): string {
    spawnSync("git", ["-C", this.workspacePath, "add", "-A"]);
    const args = [
      "-C",
      this.workspacePath,
      "-c",
      `user.name=${this.name}`,
      "-c",
      `user.email=${this.id}@flaregit.local`,
      "commit",
      "-m",
      message,
    ];
    if (allowEmpty) {
      args.splice(args.length - 2, 0, "--allow-empty");
    }
    const res = spawnSync("git", args);

    if (res.status !== 0) {
      const err = res.stderr.toString();
      this.executionLogs.push({
        action: { type: "commit", message },
        timestamp: new Date().toISOString(),
        success: false,
        output: err,
      });
      throw new Error(`Git commit failed: ${err}`);
    }

    const hash = spawnSync("git", [
      "-C",
      this.workspacePath,
      "rev-parse",
      "HEAD",
    ])
      .stdout.toString()
      .trim();

    this.executionLogs.push({
      action: { type: "commit", message },
      timestamp: new Date().toISOString(),
      success: true,
      output: `Committed ${hash.slice(0, 7)}: ${message}`,
    });

    return hash;
  }

  push(): void {
    const res = spawnSync("git", [
      "-C",
      this.workspacePath,
      "push",
      "origin",
      `${this.task.workspace.branch}:${this.task.workspace.branch}`,
    ]);

    if (res.status !== 0) {
      const err = res.stderr.toString();
      this.executionLogs.push({
        action: { type: "push" },
        timestamp: new Date().toISOString(),
        success: false,
        output: err,
      });
      throw new Error(`Git push failed: ${err}`);
    }

    this.executionLogs.push({
      action: { type: "push" },
      timestamp: new Date().toISOString(),
      success: true,
      output: "Pushed changes to task remote",
    });
  }
}
