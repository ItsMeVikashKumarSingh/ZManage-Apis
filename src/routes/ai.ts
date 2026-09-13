import { FastifyInstance } from 'fastify';
import { recommendAllocation, askStudioAssistant } from '../controllers/aiController';

export default async function aiRoutes(fastify: FastifyInstance) {
    fastify.post('/recommend-allocation', {
        schema: {
            tags: ['AI Engine'],
            summary: 'Generate optimal equipment kit and crew recommendations using Zorvik-AI',
            body: {
                type: 'object',
                required: ['shoot_title'],
                properties: {
                    shoot_title: { type: 'string' },
                    shoot_venue: { type: 'string' },
                    package_name: { type: 'string' },
                    start_time: { type: 'string' },
                    end_time: { type: 'string' },
                    client_name: { type: 'string' },
                    notes: { type: 'string' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        model: { type: 'string' },
                        recommendation: { type: 'object', additionalProperties: true }
                    }
                }
            }
        }
    }, recommendAllocation);

    fastify.post('/ask-assistant', {
        schema: {
            tags: ['AI Engine'],
            summary: 'Ask natural language questions about shoots, gear, crew, money, or inventory',
            body: {
                type: 'object',
                required: ['query'],
                properties: {
                    query: { type: 'string' },
                    conversation_history: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                role: { type: 'string', enum: ['user', 'assistant'] },
                                text: { type: 'string' }
                            }
                        }
                    }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        model: { type: 'string' },
                        answer: { type: 'string' }
                    }
                }
            }
        }
    }, askStudioAssistant);
}
