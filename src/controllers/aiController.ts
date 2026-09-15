import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';
import { env } from '../config/env';
import { logAuditEvent } from '../utils/auditLogger';

interface RecommendAllocationBody {
    shoot_title: string;
    shoot_venue?: string;
    package_name?: string;
    start_time?: string;
    end_time?: string;
    client_name?: string;
    notes?: string;
}

export async function recommendAllocation(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const body = (request.body || {}) as RecommendAllocationBody;

    const {
        shoot_title = 'Production Shoot',
        shoot_venue = 'Studio / On-Location',
        package_name = '',
        start_time = '',
        end_time = '',
        client_name = '',
        notes = ''
    } = body;

    try {
        // 1. Fetch available hardware assets, kits, and active workers for this tenant
        const [assetsRes, kitsRes, workersRes] = await Promise.all([
            supabase
                .schema('zmanage')
                .from('assets')
                .select('id, name, code, category, condition, status')
                .eq('project_id', projectId)
                .eq('deleted_flag', false)
                .order('name', { ascending: true }),
            supabase
                .schema('zmanage')
                .from('asset_kits')
                .select('id, name, code, category, total_kits_count')
                .eq('project_id', projectId)
                .eq('deleted_flag', false)
                .order('name', { ascending: true }),
            supabase
                .schema('zmanage')
                .from('workers')
                .select('id, name, primary_role, day_rate, is_active')
                .eq('project_id', projectId)
                .eq('deleted_flag', false)
                .order('name', { ascending: true })
        ]);

        const assets = assetsRes.data || [];
        const kits = kitsRes.data || [];
        const workers = workersRes.data || [];

        // 2. Prepare structured context for Zorvik-AI
        const assetSummary = assets.map(a => `ID: ${a.id} | Name: ${a.name} | Category: ${a.category} | Status: ${a.status} | Condition: ${a.condition}`).join('\n');
        const kitSummary = kits.map(k => `Kit: ${k.name} (${k.code || 'N/A'}) - Category: ${k.category || 'General'}`).join('\n');
        const workerSummary = workers.map(w => `ID: ${w.id} | Name: ${w.name} | Role: ${w.primary_role}`).join('\n');

        const promptText = `
You are Zorvik-AI, an expert creative studio production director and cinema technician for Zorvik ZManage RMS.
Analyze the following shoot details and recommend the optimal hardware package, equipment kit, and crew assignments from the studio's actual inventory.

=== SHOOT DETAILS ===
Title: ${shoot_title}
Package: ${package_name || 'Standard Production'}
Venue: ${shoot_venue}
Start: ${start_time} | End: ${end_time}
Client: ${client_name || 'N/A'}
Notes / Requests: ${notes || 'None'}

=== AVAILABLE STUDIO HARDWARE ASSETS ===
${assetSummary || 'No individual assets cataloged.'}

=== AVAILABLE PRE-PACKAGED KITS ===
${kitSummary || 'No composite kits cataloged.'}

=== AVAILABLE CREW MEMBERS ===
${workerSummary || 'No crew members cataloged.'}

=== INSTRUCTIONS ===
1. Select the most relevant assets from the AVAILABLE ASSETS list (use their exact IDs). Prioritize available gear in excellent/good condition.
2. Select the most relevant crew members from the AVAILABLE CREW list (use their exact IDs).
3. If drone or aerial is mentioned, include drone pilot and drone hardware if available.
4. For weddings/cinematography, ensure minimum 2 cameras (A-cam, B-cam), essential primes/zooms, wireless audio, and lighting.
5. Provide critical shoot preparedness tips (e.g. battery redundancy, ND filters, golden hour timing).

Return ONLY valid, parseable JSON with NO markdown formatting, NO backticks, and NO conversational filler:
{
  "recommended_asset_ids": ["uuid-1", "uuid-2"],
  "recommended_worker_ids": ["uuid-worker-1"],
  "recommended_kit_names": ["Kit Name"],
  "gear_manifest": [
    {"category": "Cameras", "item_name": "Name", "reason": "Primary A-cam 4K 60fps"}
  ],
  "crew_roles": [
    {"role": "lead_cinematographer", "suggested_count": 1, "reason": "Lead gimbal & A-cam coverage"}
  ],
  "critical_tips": [
    "Ensure minimum 4 V-mount batteries charged for extended reception",
    "Bring variable ND filters for midday outdoor shots"
  ],
  "confidence_score": 95,
  "ai_summary": "Short 2-sentence summary explaining this recommendation package"
}
`.trim();

        let aiResult: any = null;
        let modelUsed = 'rule-based-fallback';

        // 3. Attempt calling Zorvik-AI Microservice with timeout
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);

            const aiResponse = await fetch(`${env.ZORVIK_AI_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-tenant-id': 'zorvik-studio-prod',
                    'x-client-id': clientId || 'zmanage-service',
                    'x-project-id': projectId || ''
                },
                body: JSON.stringify({
                    prompt: promptText,
                    mode: 'auto',
                    stream: false
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (aiResponse.ok) {
                const aiData = (await aiResponse.json()) as { model?: string; response?: string };
                modelUsed = aiData.model || 'zorvik-ai-cascade';
                const rawText = (aiData.response || '').trim();

                // Strip any markdown code fences if model enclosed JSON
                const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
                aiResult = JSON.parse(cleanJson);
            }
        } catch {
            // Zorvik-AI microservice offline or timed out; seamless rule-based fallback kicks in
            aiResult = null;
        }

        // 4. Fallback Heuristic Recommender (Guarantees zero-downtime & intelligent defaults)
        if (!aiResult || !Array.isArray(aiResult.recommended_asset_ids)) {
            const isWeddingOrPreWedding = /wedding|pre-wedding|reception|engagement/i.test(`${shoot_title} ${package_name} ${notes}`);
            const isAerial = /drone|aerial|fly/i.test(`${shoot_title} ${package_name} ${notes}`);
            const isPortraitOrFashion = /portrait|model|fashion|studio/i.test(`${shoot_title} ${package_name} ${notes}`);

            const selectedAssetIds: string[] = [];
            const selectedWorkerIds: string[] = [];
            const gearManifest: any[] = [];
            const tips: string[] = [];

            // Select cameras (up to 2 for weddings, 1 for portraits)
            const availableCameras = assets.filter(a => a.category?.toLowerCase() === 'cameras' && a.status === 'available');
            const maxCameras = isWeddingOrPreWedding ? 2 : 1;
            availableCameras.slice(0, maxCameras).forEach(c => {
                selectedAssetIds.push(c.id);
                gearManifest.push({ category: 'Cameras', item_name: c.name, reason: 'Primary production camera' });
            });

            // Select lenses
            const availableLenses = assets.filter(a => a.category?.toLowerCase() === 'lenses' && a.status === 'available');
            availableLenses.slice(0, 2).forEach(l => {
                selectedAssetIds.push(l.id);
                gearManifest.push({ category: 'Lenses', item_name: l.name, reason: 'High-speed cinematic focal range' });
            });

            // Select lighting / audio
            const availableLights = assets.filter(a => a.category?.toLowerCase().includes('light') && a.status === 'available');
            if (availableLights.length > 0) {
                selectedAssetIds.push(availableLights[0].id);
                gearManifest.push({ category: 'Lighting', item_name: availableLights[0].name, reason: 'Subject key light illumination' });
            }

            const availableAudio = assets.filter(a => a.category?.toLowerCase().includes('audio') && a.status === 'available');
            if (availableAudio.length > 0) {
                selectedAssetIds.push(availableAudio[0].id);
                gearManifest.push({ category: 'Audio', item_name: availableAudio[0].name, reason: 'Primary dialogue & speech capture' });
            }

            // Drones if requested
            if (isAerial) {
                const availableDrones = assets.filter(a => a.category?.toLowerCase().includes('drone') && a.status === 'available');
                if (availableDrones.length > 0) {
                    selectedAssetIds.push(availableDrones[0].id);
                    gearManifest.push({ category: 'Drones & Aerial', item_name: availableDrones[0].name, reason: 'Establishing 4K aerial sweeps' });
                }
            }

            // Crew assignments
            const leadCine = workers.find(w => w.primary_role?.toLowerCase().includes('cinematographer') || w.primary_role?.toLowerCase().includes('photographer'));
            if (leadCine) selectedWorkerIds.push(leadCine.id);

            if (isAerial) {
                const dronePilot = workers.find(w => w.primary_role?.toLowerCase().includes('drone') && w.id !== leadCine?.id);
                if (dronePilot) selectedWorkerIds.push(dronePilot.id);
            }

            if (isWeddingOrPreWedding) {
                tips.push('Pack at least 4x formatted V90 UHS-II SD cards with dual-slot redundancy.');
                tips.push('Bring backup battery chargers and cold-shoe LED fill panels for reception evening.');
            } else if (isPortraitOrFashion) {
                tips.push('Prepare tethering cable and color-checker chart for accurate studio white balance.');
            } else {
                tips.push('Perform sensor swab inspection and calibrate gimbal motors prior to call time.');
            }

            aiResult = {
                recommended_asset_ids: selectedAssetIds,
                recommended_worker_ids: selectedWorkerIds,
                recommended_kit_names: kits.slice(0, 1).map(k => k.name),
                gear_manifest: gearManifest,
                crew_roles: [
                    { role: 'lead_cinematographer', suggested_count: 1, reason: 'Primary framing & motion tracking' }
                ],
                critical_tips: tips,
                confidence_score: 88,
                ai_summary: `Zorvik-AI recommended ${selectedAssetIds.length} production items and ${selectedWorkerIds.length} crew shift assignments based on shoot parameters.`
            };
        }

        // 5. Audit Log Entry
        logAuditEvent(
            request,
            'AI_RECOMMENDATION_GENERATED',
            'ALLOCATION',
            {
                shoot_title,
                model_used: modelUsed,
                confidence_score: aiResult.confidence_score,
                recommended_assets_count: (aiResult.recommended_asset_ids || []).length,
                recommended_workers_count: (aiResult.recommended_worker_ids || []).length
            }
        );

        return reply.send({
            success: true,
            model: modelUsed,
            recommendation: aiResult
        });
    } catch (err: any) {
        return reply.code(500).send({
            error: err.message || 'Failed to generate AI allocation recommendation'
        });
    }
}

interface AssistantFileAttachment {
    name: string;
    mimeType: string;
    data: string; // base64 string
}

interface AskStudioAssistantBody {
    query: string;
    conversation_history?: Array<{ role: 'user' | 'assistant'; text: string }>;
    session_id?: string;
    files?: AssistantFileAttachment[];
}

export async function askStudioAssistant(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const body = (request.body || {}) as AskStudioAssistantBody;
    const query = (body.query || '').trim();

    if (!query) {
        return reply.code(400).send({
            error: 'Query is required.'
        });
    }

    try {
        // Fetch complete studio context concurrently (matching either projectId or clientId for maximum resilience)
        const [
            assetsRes,
            workersRes,
            allocationsRes,
            studioBookingsRes,
            payoutsRes,
            vaultsRes,
            consumablesRes
        ] = await Promise.all([
            supabase
                .schema('zmanage')
                .from('assets')
                .select('id, name, code, category, condition, status, purchase_cost, serial_number, project_id, client_id')
                .or(`project_id.eq.${projectId},client_id.eq.${clientId}`)
                .eq('deleted_flag', false)
                .limit(50),
            supabase
                .schema('zmanage')
                .from('workers')
                .select('id, name, primary_role, phone, day_rate, is_active, project_id, client_id')
                .or(`project_id.eq.${projectId},client_id.eq.${clientId}`)
                .eq('deleted_flag', false),
            supabase
                .schema('zmanage')
                .from('allocations')
                .select('id, title, venue, client_name, client_phone, start_time, end_time, status, notes, project_id, client_id')
                .or(`project_id.eq.${projectId},client_id.eq.${clientId}`)
                .eq('deleted_flag', false)
                .order('start_time', { ascending: true })
                .limit(20),
            supabase
                .schema('studio')
                .from('tbl_bookings')
                .select('*')
                .eq('tb_deleted_flag', false)
                .order('tb_created_at', { ascending: false })
                .limit(25),
            supabase
                .schema('zmanage')
                .from('worker_payouts')
                .select('id, worker_id, total_amount, amount, payout_status, status, payment_mode, reference_number, project_id, client_id')
                .or(`project_id.eq.${projectId},client_id.eq.${clientId}`)
                .eq('deleted_flag', false)
                .limit(50),
            supabase
                .schema('zmanage')
                .from('storage_locations')
                .select('id, name, code, type, capacity, project_id, client_id')
                .or(`project_id.eq.${projectId},client_id.eq.${clientId}`)
                .eq('deleted_flag', false),
            supabase
                .schema('zmanage')
                .from('consumables')
                .select('id, name, category, stock_quantity, min_reorder_level, unit, project_id, client_id')
                .or(`project_id.eq.${projectId},client_id.eq.${clientId}`)
                .eq('deleted_flag', false)
        ]);

        const assets = assetsRes.data || [];
        const workers = workersRes.data || [];
        const allocations = allocationsRes.data || [];
        const rawBookings = studioBookingsRes.data || [];
        const payouts = payoutsRes.data || [];
        const vaults = vaultsRes.data || [];
        const consumables = consumablesRes.data || [];

        // Parse bookings identically to allocationsController
        const bookings = rawBookings
            .filter(b => !clientId || b.client_id === clientId)
            .map(b => {
                const pd = b.tb_payment_details || {};
                const cj = b.tb_customer_json || {};
                const ps = b.tb_package_snapshot || {};
                return {
                    booking_id: b.tb_id,
                    order_id: pd.order_id || b.tb_id.slice(0, 8),
                    package_name: ps.title || pd.packageName || 'Studio Client Shoot',
                    client_name: cj.customerName || pd.customerName || cj.name || 'Client',
                    client_phone: cj.customerPhone || pd.customerPhone || cj.phone || '',
                    event_date: pd.event_date || cj.event_date || b.tb_created_at?.split('T')[0] || '2026-10-15',
                    venue: cj.venue || pd.venue || 'Studio / On-Location',
                    amount: Number(b.tb_amount) || 0,
                    status: b.tb_status || 'confirmed'
                };
            });

        // Compute high-level studio totals
        const totalItems = assets.length;
        const availableItems = assets.filter(a => a.status === 'available').length;
        const onShootItems = assets.filter(a => a.status === 'on_shoot' || a.status === 'in_use').length;
        const maintenanceItems = assets.filter(a => a.status === 'maintenance' || a.status === 'in_repair').length;

        const isSettled = (p: any) => p.status === 'settled' || p.payout_status === 'paid' || p.payout_status === 'settled';
        const isPending = (p: any) => p.status === 'pending' || p.payout_status === 'pending' || p.payout_status === 'approved';

        const pendingPayoutsTotal = payouts.filter(isPending).reduce((sum, p: any) => sum + (Number(p.total_amount ?? p.amount) || 0), 0);
        const settledPayoutsTotal = payouts.filter(isSettled).reduce((sum, p: any) => sum + (Number(p.total_amount ?? p.amount) || 0), 0);

        // Summarize schedule (upcoming shoots and client bookings)
        const upcomingShoots = [
            ...allocations.map(a => `Shoot: "${a.title}" | Client: ${a.client_name || 'N/A'} | Venue: ${a.venue || 'TBD'} | Time: ${a.start_time} to ${a.end_time} | Status: ${a.status}`),
            ...bookings.map(b => `Studio Booking: "${b.package_name}" | Client: ${b.client_name} (${b.client_phone || 'N/A'}) | Date: ${b.event_date} | Venue: ${b.venue} | Fee: ₹${b.amount} | Status: ${b.status}`)
        ].slice(0, 15).join('\n');

        const workersList = workers.map(w => `Worker: ${w.name} | Role: ${w.primary_role} | Phone: ${w.phone || 'N/A'} | Rate: ₹${w.day_rate}/day | Active: ${w.is_active}`).join('\n');
        const vaultsList = vaults.map(v => `Vault: ${v.name} (${v.code || 'N/A'}) | Type: ${v.type} | Capacity: ${v.capacity || 'N/A'}`).join('\n');
        const lowStockConsumables = consumables.filter(c => c.stock_quantity <= c.min_reorder_level).map(c => `${c.name}: ${c.stock_quantity} ${c.unit} (Alert: <= ${c.min_reorder_level})`).join(', ');

        const conversationContext = (body.conversation_history || [])
            .slice(-6)
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .join('\n');

        const attachedFiles = (body.files || []).map((f: any) => ({
            name: f.name || 'document',
            mimeType: f.mimeType || 'application/pdf',
            data: f.data || f.base64 || '',
            base64: f.base64 || f.data || ''
        }));
        const hasFiles = attachedFiles.length > 0;

        let fileDirectives = '';
        if (hasFiles) {
            const filesList = attachedFiles.map(f => `• "${f.name}" (${f.mimeType})`).join('\n');
            fileDirectives = `\n\n=== ATTACHED DOCUMENTS & MEDIA ===\nThe user has attached the following file(s):\n${filesList}\n\nCRITICAL DIRECTIVE FOR ATTACHMENTS:\n1. Prioritize analyzing, inspecting, and extracting information from the attached document(s)/image(s) first.\n2. Directly answer the user's question based on the document's content (e.g. line items, invoice numbers, amounts, dates, parties, equipment lists, or call sheet logistics).\n3. Do NOT recite or dump unrelated studio gear inventory, pending payouts, or crew lists unless the user explicitly asks how the attached document connects to studio assets or bookings.`;
        }

        const systemPrompt = `
You are Zorvik-AI Studio Director, the intelligent AI copilot for Zorvik ZManage RMS.
You have complete, live, real-time access to the studio's operations, bookings, gear inventory, team members, and finances.
Today's Date: ${new Date().toISOString().split('T')[0]}

=== LIVE STUDIO OPERATIONS CONTEXT ===
• INVENTORY: Total: ${totalItems} items (${availableItems} Available, ${onShootItems} On Shoot / In Use, ${maintenanceItems} Maintenance/Repair).
Sample Gear: ${assets.slice(0, 15).map(a => `${a.name} [${a.code || 'SKU'}, Status: ${a.status}, Cond: ${a.condition}]`).join('; ')}

• FINANCIALS & PAYOUTS:
- Pending Contractor Payouts: ₹${pendingPayoutsTotal.toLocaleString()} (${payouts.filter(isPending).length} pending)
- Settled Disbursals: ₹${settledPayoutsTotal.toLocaleString()} (${payouts.filter(isSettled).length} paid)

• UPCOMING SHOOTS & BOOKINGS:
${upcomingShoots || 'No upcoming shoots currently scheduled.'}

• CREW & WORKFORCE:
${workersList || 'No crew members currently registered.'}

• STORAGE VAULTS & HUBS:
${vaultsList || 'No physical vaults registered.'}

• LOW STOCK EXPENDABLES:
${lowStockConsumables || 'All consumables in healthy stock.'}
${fileDirectives}

=== INSTRUCTIONS ===
1. Answer the user's question directly, accurately, and concisely based on the live context above.
2. If documents or images are attached, prioritize analyzing the document content first.
3. If asked about "next shoot", "today's schedule", or dates, check UPCOMING SHOOTS & BOOKINGS and cite the exact title, date, venue, client, and time.
4. If asked about team members, technicians, or crew rates, cite their exact roles, rates, and contact info from CREW & WORKFORCE.
5. If asked about gear, devices, or cameras, explain their status (available, on shoot, or maintenance) and location.
6. If asked about money, compensation, or payouts, cite the exact pending and settled figures.
7. Format your answer with clean Markdown, bullet points, and bold text for easy readability. Keep answers friendly, professional, and directly actionable.
`.trim();

        const fullPrompt = conversationContext 
            ? `${systemPrompt}\n\n=== RECENT CONVERSATION ===\n${conversationContext}\n\nUser Question: ${query}`
            : `${systemPrompt}\n\nUser Question: ${query}`;

        let replyText = '';
        let modelUsed = 'rule-based-fallback';

        const zorvikEndpoints = [
            env.ZORVIK_AI_URL,
            'http://127.0.0.1:3000/api/v1'
        ].filter(Boolean);

        for (const endpoint of zorvikEndpoints) {
            try {
                const timeoutMs = hasFiles ? 25000 : 12000;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                const aiResponse = await fetch(`${endpoint}/chat`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-tenant-id': 'zorvik-studio-prod',
                        'x-client-id': clientId || 'zmanage-service',
                        'x-project-id': projectId || '',
                        'x-session-id': body.session_id || 'studio-default'
                    },
                    body: JSON.stringify({
                        prompt: fullPrompt,
                        mode: 'auto',
                        session_id: body.session_id,
                        files: attachedFiles,
                        stream: false
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (aiResponse.ok) {
                    const aiData = (await aiResponse.json()) as { model?: string; response?: string };
                    const text = (aiData.response || '').trim();
                    const isBudgetError = text.toLowerCase().includes('reached its budget') || 
                                         text.toLowerCase().includes('raise the key budget') ||
                                         text.toLowerCase().includes('pollinations');
                    if (!isBudgetError && text) {
                        modelUsed = 'Zorvik AI Studio Ultra';
                        replyText = text;
                        break;
                    }
                }
            } catch {
                // Try next endpoint candidate
            }
        }

        // Heuristic fallback if AI service was unreachable
        if (!replyText) {
            if (hasFiles) {
                const fileNames = attachedFiles.map(f => `**"${f.name}"** (${f.mimeType})`).join(', ');
                replyText = `**Document Received:** ${fileNames}\n\nThe attached file was successfully received by Zorvik AI Studio Ultra. However, real-time AI neural document parsing is momentarily busy. Please ask a specific question about this document or retry in a few moments.`;
            } else {
                const q = query.toLowerCase();
                if (q.includes('shoot') || q.includes('booking') || q.includes('schedule') || q.includes('next')) {
                    const nextShoot = allocations[0] || bookings[0];
                    if (nextShoot) {
                        const title = (nextShoot as any).shoot_title || (nextShoot as any).title || (nextShoot as any).package_name;
                        const date = (nextShoot as any).start_time || (nextShoot as any).event_date;
                        const venue = (nextShoot as any).shoot_venue || (nextShoot as any).venue || 'Studio Floor';
                        replyText = `**Next Scheduled Shoot:** **"${title}"**\n• **Date/Time:** ${date}\n• **Venue:** ${venue}\n• **Client:** ${(nextShoot as any).client_name || 'Direct Client'}\n• **Status:** ${(nextShoot as any).status || 'Confirmed'}`;
                    } else {
                        replyText = 'There are currently no upcoming shoots scheduled in the operations timeline.';
                    }
                } else if (q.includes('team') || q.includes('crew') || q.includes('member') || q.includes('worker') || q.includes('rate')) {
                    replyText = `**Studio Crew Roster (${workers.length} active members):**\n` + 
                        workers.slice(0, 5).map(w => `• **${w.name}** — ${w.primary_role} (₹${w.day_rate}/day)`).join('\n');
                } else if (q.includes('money') || q.includes('payout') || q.includes('pending') || q.includes('pay') || q.includes('cost')) {
                    replyText = `**Studio Financial Summary:**\n• **Pending Payouts:** ₹${pendingPayoutsTotal.toLocaleString()} (${payouts.filter(isPending).length} pending settlements)\n• **Settled Disbursals:** ₹${settledPayoutsTotal.toLocaleString()} (${payouts.filter(isSettled).length} transactions paid)`;
                } else if (q.includes('gear') || q.includes('camera') || q.includes('device') || q.includes('item') || q.includes('inventory')) {
                    replyText = `**Equipment Inventory:**\n• **Total Gear:** ${totalItems} items\n• **Available Now:** ${availableItems} items\n• **On Shoot:** ${onShootItems} items\n• **In Maintenance:** ${maintenanceItems} items`;
                } else {
                    replyText = `I am **Zorvik-AI Studio Copilot**. You can ask me anything about:\n• **Shoots & Schedule:** *"When is my next shoot?"* or *"Who is booked this weekend?"*\n• **Team & Crew:** *"What is the day rate for our lead cinematographer?"*\n• **Inventory & Gear:** *"How many cameras are available right now?"*\n• **Money & Payouts:** *"How much payout is pending for contractors?"*`;
                }
            }
        }

        logAuditEvent(
            request,
            'AI_STUDIO_ANSWER',
            'ALLOCATION',
            {
                query: query.slice(0, 100),
                model_used: modelUsed
            }
        );

        return reply.send({
            success: true,
            model: 'Zorvik AI Studio Ultra',
            answer: replyText
        });
    } catch (err: any) {
        return reply.code(500).send({
            error: err.message || 'Failed to process studio query'
        });
    }
}
