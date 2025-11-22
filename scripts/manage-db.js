import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const ENV = process.env.NODE_ENV || 'development';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_PATH = join(__dirname, '..');
const SCHEMA_PATH = join(ROOT_PATH, 'prisma');

function getSchemaInfo() {
    const sourceSchema = ENV === 'development'
        ? join(SCHEMA_PATH, 'schema.dev.prisma')
        : join(SCHEMA_PATH, 'schema.prod.prisma');

    // Read the schema to determine provider and database path
    const schemaContent = fs.readFileSync(sourceSchema, 'utf8');
    const providerMatch = schemaContent.match(/provider\s*=\s*"(\w+)"/);
    const urlMatch = schemaContent.match(/url\s*=\s*"([^"]+)"/);

    return {
        sourceSchema,
        provider: providerMatch ? providerMatch[1] : 'sqlite',
        dbUrl: urlMatch ? urlMatch[1] : 'file:./dev.db'
    };
}

function copySchema() {
    const { sourceSchema } = getSchemaInfo();
    const targetSchema = join(SCHEMA_PATH, 'schema.prisma');

    console.log(`Copying ${ENV} schema...`);
    fs.copyFileSync(sourceSchema, targetSchema);
}

function resetDatabase() {
    const { provider, dbUrl } = getSchemaInfo();

    console.log(`Resetting ${provider} database...`);

    if (provider === 'sqlite') {
        // For SQLite, delete the database file
        const dbPath = dbUrl.replace('file:', '');
        const fullDbPath = join(SCHEMA_PATH, dbPath);
        if (fs.existsSync(fullDbPath)) {
            fs.unlinkSync(fullDbPath);
            console.log(`Deleted SQLite database: ${fullDbPath}`);
        }
        // Also delete any journal files
        const journalPath = fullDbPath + '-journal';
        if (fs.existsSync(journalPath)) {
            fs.unlinkSync(journalPath);
            console.log(`Deleted SQLite journal: ${journalPath}`);
        }
    } else {
        // For PostgreSQL, we can't delete the database, but we can warn
        console.log(`⚠️  PostgreSQL database detected. Manual database reset may be required.`);
        console.log(`   Database URL: ${dbUrl}`);
    }
}

function resetMigrations() {
    const { provider } = getSchemaInfo();
    const migrationsDir = join(SCHEMA_PATH, 'migrations');

    console.log('Resetting migration history...');

    // Delete all migration files but keep the directory
    if (fs.existsSync(migrationsDir)) {
        const files = fs.readdirSync(migrationsDir);
        for (const file of files) {
            const filePath = join(migrationsDir, file);
            if (file !== 'migration_lock.toml') {
                fs.rmSync(filePath, { recursive: true, force: true });
                console.log(`Deleted migration: ${file}`);
            }
        }
    }

    // Update/create migration lock file
    const lockFile = join(migrationsDir, 'migration_lock.toml');
    fs.writeFileSync(lockFile, `provider = "${provider}"\n`);
    console.log(`Updated migration lock for ${provider}`);
}

function createInitialMigration() {
    console.log('Creating initial migration...');
    try {
        execSync('npx prisma migrate dev --name init --create-only', { stdio: 'inherit' });
    } catch (error) {
        // If migration already exists, that's ok
        console.log('Migration creation completed (may have already existed)');
    }
}

function generateClient() {
    console.log('Generating Prisma Client...');
    execSync('npx prisma generate', { stdio: 'inherit' });
}

function runMigrations() {
    console.log('Running database migrations...');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
}

function createAndApplyMigration() {
    console.log('Creating and applying fresh migration...');
    execSync('npx prisma migrate dev --name init', { stdio: 'inherit' });
}

function main() {
    const command = process.argv[2];

    try {
        switch (command) {
            case 'reset':
                resetDatabase();
                resetMigrations();
                copySchema();
                createAndApplyMigration();
                generateClient();
                break;

            case 'setup':
                // Try to run existing migrations first
                try {
                    copySchema();
                    runMigrations();
                    console.log('✅ Existing migrations applied successfully');
                } catch (migrationError) {
                    console.log('⚠️  Existing migrations failed, resetting database...');
                    // Fall back to reset if migrations fail
                    resetDatabase();
                    resetMigrations();
                    copySchema();
                    createAndApplyMigration();
                    console.log('✅ Database reset and fresh migrations created');
                }
                // Always generate client at the end
                generateClient();
                break;

            case 'generate':
                copySchema();
                generateClient();
                break;

            case 'migrate':
                copySchema();
                runMigrations();
                break;

            default:
                console.error('Available commands:');
                console.error('  reset   - Force reset database and create fresh migrations');
                console.error('  setup   - Setup database (uses existing migrations, resets if failed)');
                console.error('  generate - Generate Prisma client only');
                console.error('  migrate  - Run existing migrations only (fails if incompatible)');
                process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error.message);
        console.error('\nTroubleshooting:');
        console.error('- For SQLite issues, try: npm run db:reset:dev');
        console.error('- For PostgreSQL issues, ensure DATABASE_URL is set');
        process.exit(1);
    }
}

main(); 