import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const ENV = process.env.NODE_ENV || 'development';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_PATH = join(__dirname, '..');
const SCHEMA_PATH = join(ROOT_PATH, 'prisma');

function resetDatabase() {
    console.log(`Resetting ${ENV} database...`);

    if (ENV === 'development') {
        // For SQLite, delete the database file
        const dbPath = join(SCHEMA_PATH, 'dev.db');
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
            console.log(`Deleted SQLite database: ${dbPath}`);
        }
        // Also delete any journal files
        const journalPath = dbPath + '-journal';
        if (fs.existsSync(journalPath)) {
            fs.unlinkSync(journalPath);
            console.log(`Deleted SQLite journal: ${journalPath}`);
        }
    } else {
        // For PostgreSQL, we can't delete the database, but we can warn
        console.log(`⚠️  PostgreSQL database detected. Manual database reset may be required.`);
        console.log(`   Database URL: ${process.env.DATABASE_URL || '(not set)'}`);
    }
}

function resetMigrations() {
    const migrationsDir = join(SCHEMA_PATH, 'migrations');
    const provider = ENV === 'production' ? 'postgresql' : 'sqlite';

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
                createAndApplyMigration();
                generateClient();
                break;

            case 'setup':
                // Try to run existing migrations first
                try {
                    runMigrations();
                    console.log('✅ Existing migrations applied successfully');
                } catch (migrationError) {
                    console.log('⚠️  Existing migrations failed, resetting database...');
                    // Fall back to reset if migrations fail
                    resetDatabase();
                    resetMigrations();
                    createAndApplyMigration();
                    console.log('✅ Database reset and fresh migrations created');
                }
                // Always generate client at the end
                generateClient();
                break;

            case 'generate':
                generateClient();
                break;

            case 'migrate':
                runMigrations();
                break;

            default:
                console.error('Available commands:');
                console.error('  reset    - Force reset database and create fresh migrations');
                console.error('  setup    - Setup database (uses existing migrations, resets if failed)');
                console.error('  generate - Generate Prisma client only');
                console.error('  migrate  - Run existing migrations only');
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