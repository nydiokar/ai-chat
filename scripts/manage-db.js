import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const ENV = process.env.NODE_ENV || 'development';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_PATH = join(__dirname, '..');
const SCHEMA_PATH = join(ROOT_PATH, 'prisma');

function copySchema() {
    const sourceSchema = ENV === 'development' 
        ? join(SCHEMA_PATH, 'schema.dev.prisma')
        : join(SCHEMA_PATH, 'schema.prod.prisma');
    const targetSchema = join(SCHEMA_PATH, 'schema.prisma');
    
    console.log(`Copying ${ENV} schema...`);
    fs.copyFileSync(sourceSchema, targetSchema);
}

function generateClient() {
    console.log('Generating Prisma Client...');
    const schemaPath = ENV === 'development' 
        ? './prisma/schema.dev.prisma'
        : './prisma/schema.prod.prisma';
    execSync(`npx prisma generate --schema=${schemaPath}`, { stdio: 'inherit' });
}

function runMigrations() {
    console.log('Running database migrations...');
    const schemaPath = ENV === 'development' 
        ? './prisma/schema.dev.prisma'
        : './prisma/schema.prod.prisma';
    execSync(`npx prisma migrate deploy --schema=${schemaPath}`, { stdio: 'inherit' });
}

function main() {
    const command = process.argv[2];
    
    try {
        switch (command) {
            case 'setup':
                copySchema();
                generateClient();
                runMigrations();
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
                console.error('Unknown command. Use: setup, generate, or migrate');
                process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main(); 