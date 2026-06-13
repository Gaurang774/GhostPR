const path = require('path');
const fs = require('fs');

function getMcpConfig() {
  const rootDir = path.resolve(__dirname, '..');
  const mcpServerPathSrc = path.join(rootDir, 'apps', 'mcp-server', 'src', 'index.ts');
  const mcpServerPathDist = path.join(rootDir, 'apps', 'mcp-server', 'dist', 'index.js');
  const dbPath = path.join(rootDir, 'data', 'GhostPR.db');
  const distExists = fs.existsSync(mcpServerPathDist);

  const env = {
    DATABASE_PATH: './data/GhostPR.db',
    NODE_ENV: 'development',
  };

  const configCompiled = {
    mcpServers: {
      GhostPR: {
        command: 'node',
        args: [mcpServerPathDist],
        cwd: rootDir,
        env,
      },
    },
  };

  const configTS = {
    mcpServers: {
      GhostPR: {
        command: 'node',
        args: ['--import', 'tsx/esm', mcpServerPathSrc],
        cwd: rootDir,
        env,
      },
    },
  };

  const cursorMcpPath = path.join(rootDir, '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cursorMcpPath), { recursive: true });
  const cursorConfig = distExists ? configCompiled : configTS;
  fs.writeFileSync(cursorMcpPath, JSON.stringify(cursorConfig, null, 2) + '\n');

  console.log('\n==================================================');
  console.log('✅ GhostPR MCP Server Configuration');
  console.log('==================================================\n');
  console.log(`Project MCP config written to: ${cursorMcpPath}`);
  console.log(`Database target: ${dbPath}`);
  console.log(`Build status: ${distExists ? 'compiled dist found' : 'dist missing — run "pnpm run build" first'}\n`);

  console.log('Add this server to Cursor Settings > Features > MCP > "+ Add New" or');
  console.log('edit your Claude Desktop config (~/AppData/Roaming/Claude/claude_desktop_config.json).\n');

  console.log('--------------------------------------------------');
  console.log('👉 OPTION A: Pre-compiled Bundle (Recommended - Fastest & Zero Dependencies)');
  if (!distExists) {
    console.log('   ⚠ Run "pnpm run build" first — dist/index.js not found yet.');
  }
  console.log('--------------------------------------------------');
  console.log(JSON.stringify(configCompiled, null, 2));
  console.log('\n--------------------------------------------------');
  console.log('👉 OPTION B: Live TypeScript (uses workspace tsx)');
  console.log('--------------------------------------------------');
  console.log(JSON.stringify(configTS, null, 2));
  console.log('\n==================================================\n');
}

getMcpConfig();
