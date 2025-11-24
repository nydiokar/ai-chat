import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const ENV = process.env.NODE_ENV || 'development';

// Use environment-specific schema files to avoid provider validation issues
// Each schema file has the correct provider (sqlite vs postgresql)
const getSchemaPath = () => {
  return ENV === 'production'
    ? 'prisma/schema.prod.prisma'
    : 'prisma/schema.dev.prisma';
};

// Conditional database configuration based on environment
const getDatasourceConfig = () => {
  if (ENV === 'production') {
    // Production: PostgreSQL from environment variable
    if (!process.env.DATABASE_URL) {
      console.warn('⚠️  DATABASE_URL not set for production environment');
    }
    return {
      url: process.env.DATABASE_URL || '',
    };
  } else {
    // Development: SQLite - use the DATABASE_URL from .env which is file:./dev.db
    return {
      url: process.env.DATABASE_URL || 'file:./dev.db',
    };
  }
};

export default defineConfig({
  schema: getSchemaPath(),
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: getDatasourceConfig(),
});
