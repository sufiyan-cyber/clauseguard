import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const colors = {
  qdrant: "\x1b[36m", // Cyan
  agent: "\x1b[35m",  // Magenta
  web: "\x1b[32m",    // Green
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

const processes = [];

function prefixStream(stream, label, color) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep last incomplete line
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${color}${label}${colors.reset} ${line}`);
      }
    }
  });
}

function startProcess(name, cmd, args, cwd, color) {
  console.log(`${colors.bold}Starting ${name}...${colors.reset}`);
  const proc = spawn(cmd, args, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  prefixStream(proc.stdout, `[${name}]`, color);
  prefixStream(proc.stderr, `[${name}]`, color);

  proc.on("exit", (code, signal) => {
    console.log(`${color}[${name}]${colors.reset} exited with code ${code ?? signal}`);
  });

  processes.push(proc);
  return proc;
}

console.log(`${colors.bold}========================================`);
console.log(`  Starting ClauseGuard All-In-One`);
console.log(`========================================${colors.reset}\n`);

// 1. Qdrant
const qdrantDir = path.join(__dirname, "qdrant-local");
startProcess("Qdrant", ".\\qdrant.exe", [], qdrantDir, colors.qdrant);

// 2. Agent (Mastra)
const agentDir = path.join(__dirname, "agent");
startProcess("Agent ", "npm", ["run", "dev"], agentDir, colors.agent);

// 3. Web (Next.js)
const webDir = path.join(__dirname, "web");
startProcess("Web   ", "npm", ["run", "dev"], webDir, colors.web);

console.log(`\n${colors.bold}Endpoints:${colors.reset}`);
console.log(`  • Web Interface:  \x1b[34mhttp://localhost:3000\x1b[0m`);
console.log(`  • Agent Runtime:  \x1b[34mhttp://localhost:4111\x1b[0m`);
console.log(`  • Qdrant Vector:  \x1b[34mhttp://localhost:6333\x1b[0m\n`);
console.log(`Press Ctrl+C at any time to stop all servers cleanly.\n`);

function cleanup() {
  console.log(`\n${colors.bold}Stopping all ClauseGuard servers...${colors.reset}`);
  for (const proc of processes) {
    if (proc.pid) {
      try {
        spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { shell: true, stdio: "ignore" });
      } catch {}
    }
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
