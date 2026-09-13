import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    PORT: z.coerce.number().default(4003),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    APP_URL: z.string().url().default('http://localhost:4003'),
    CORS_ORIGIN: z.string().default('*'),

    // Upstash Redis
    UPSTASH_REDIS_REST_URL: z.string().default(process.env.NODE_ENV === 'test' ? 'https://mock.upstash.io' : ''),
    UPSTASH_REDIS_REST_TOKEN: z.string().default(process.env.NODE_ENV === 'test' ? 'mock_token' : ''),

    // Supabase
    SUPABASE_URL: z.string().default(process.env.NODE_ENV === 'test' ? 'https://mock.supabase.co' : ''),
    SUPABASE_SERVICE_ROLE_KEY: z.string().default(process.env.NODE_ENV === 'test' ? 'mock_service_key' : ''),

    // Zorvik AI Microservice
    ZORVIK_AI_URL: z.string().default('https://ai.zorviktech.com/api/v1'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment variables for ZManage-APIs:');
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(_env.error.format(), null, 2));
    process.exit(1);
}

export const env = _env.data;
