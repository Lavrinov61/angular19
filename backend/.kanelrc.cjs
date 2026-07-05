const { readFileSync } = require('fs');
const { join } = require('path');

// Parse .env manually (kanel runs outside of app context)
// Process env vars take priority over .env file values
const envContent = readFileSync(join(__dirname, '.env'), 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
}
// Allow overrides from process.env
for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL']) {
  if (process.env[key]) env[key] = process.env[key];
}

/** @type {import('kanel').Config} */
module.exports = {
  connection: {
    host: env.DB_HOST,
    port: parseInt(env.DB_PORT || '6432', 10),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  outputPath: './src/types/generated',
  preDeleteOutputFolder: true,
  schemas: ['public'],

  // Branded ID types for type-safe foreign key references
  // Default Kanel behavior: WorkTasksId = string & { __brand: 'public.work_tasks' }

  // Use string for dates/JSON (matches Express JSON serialization)
  customTypeMap: {
    'pg_catalog.timestamptz': { name: 'string', typeImports: [] },
    'pg_catalog.timestamp': { name: 'string', typeImports: [] },
    'pg_catalog.date': { name: 'string', typeImports: [] },
    'pg_catalog.jsonb': { name: 'Record<string, unknown>', typeImports: [] },
    'pg_catalog.json': { name: 'Record<string, unknown>', typeImports: [] },
    'pg_catalog.uuid': { name: 'string', typeImports: [] },
    'pg_catalog.numeric': { name: 'string', typeImports: [] },
    'pg_catalog.int8': { name: 'string', typeImports: [] },
    'pg_catalog.float8': { name: 'number', typeImports: [] },
    'pg_catalog.float4': { name: 'number', typeImports: [] },
    'pg_catalog.tsvector': { name: 'string', typeImports: [] },
    'public.vector': { name: 'number[]', typeImports: [] },
    'double precision': { name: 'number', typeImports: [] },
    'vector': { name: 'number[]', typeImports: [] },
    'jsonb': { name: 'Record<string, unknown>', typeImports: [] },
    'json': { name: 'Record<string, unknown>', typeImports: [] },
  },
};
