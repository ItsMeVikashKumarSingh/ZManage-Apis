import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';
import { logAuditEvent } from '../utils/auditLogger';

export async function listWorkers(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { role, worker_type, search } = request.query as { role?: string; worker_type?: string; search?: string };

    let query = supabase
        .schema('zmanage')
        .from('workers')
        .select('*')
        .eq('project_id', projectId)
        .eq('deleted_flag', false)
        .order('name', { ascending: true });

    if (role) query = query.eq('primary_role', role);
    if (worker_type) query = query.eq('worker_type', worker_type);
    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });

    return reply.send({ success: true, count: data?.length || 0, workers: data });
}

export async function createWorker(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const body = request.body as any;

    const { data, error } = await supabase
        .schema('zmanage')
        .from('workers')
        .insert({
            client_id: clientId,
            project_id: projectId,
            user_id: body.user_id || null,
            name: body.name,
            phone: body.phone,
            email: body.email,
            primary_role: body.primary_role,
            skills: body.skills || [],
            worker_type: body.worker_type || 'freelance',
            day_rate: body.day_rate || 0,
            half_day_rate: body.half_day_rate || 0,
            overtime_hourly_rate: body.overtime_hourly_rate || 0,
            currency: body.currency || 'INR',
            payment_details: body.payment_details || {},
            status: body.status || 'active'
        })
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    logAuditEvent(request, 'WORKER_ONBOARDED', 'WORKER', {
        worker_id: data.id,
        name: data.name,
        primary_role: data.primary_role,
        worker_type: data.worker_type,
        day_rate: data.day_rate
    });

    return reply.code(201).send({ success: true, worker: data });
}

export async function updateWorker(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const { data, error } = await supabase
        .schema('zmanage')
        .from('workers')
        .update({
            ...body,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    logAuditEvent(request, 'WORKER_UPDATED', 'WORKER', {
        worker_id: id,
        name: data.name,
        primary_role: data.primary_role,
        updated_fields: Object.keys(body)
    });

    return reply.send({ success: true, worker: data });
}

export async function checkWorkerAvailability(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { worker_id, start_time, end_time, exclude_allocation_id } = request.body as {
        worker_id: string;
        start_time: string;
        end_time: string;
        exclude_allocation_id?: string;
    };

    const { data, error } = await supabase.rpc('fn_check_worker_availability', {
        p_project_id: projectId,
        p_worker_id: worker_id,
        p_start_time: start_time,
        p_end_time: end_time,
        p_exclude_allocation_id: exclude_allocation_id || null
    });

    if (error) return reply.code(500).send({ error: error.message });
    return reply.send({ worker_id, is_available: Boolean(data) });
}

// 1-Tap Team Import: Step 1 - Discover Candidates from Studio profiles & Platform Users
export async function getImportCandidates(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;

    // 1. Discover registered users/staff from studio.tbl_profiles
    const { data: studioUsers, error: studioError } = await supabase
        .schema('studio')
        .from('tbl_profiles')
        .select('id, full_name, email, role, created_at')
        .eq('client_id', clientId)
        .eq('is_deleted', false);

    if (studioError) {
        // Fallback: try auth_service if available
        const { data: authUsers } = await supabase
            .schema('auth_service')
            .from('tbl_client_users')
            .select('tcu_id, tcu_display_name, tcu_phone, tcu_email, tcu_role, tcu_status, created_at')
            .eq('tcu_client_id', clientId);

        const { data: existingWorkers } = await supabase
            .schema('zmanage')
            .from('workers')
            .select('user_id, phone, email')
            .eq('project_id', projectId)
            .eq('deleted_flag', false);

        const existingUserIds = new Set((existingWorkers || []).map(w => w.user_id).filter(Boolean));
        const candidates = (authUsers || []).map(u => ({
            user_id: u.tcu_id,
            name: u.tcu_display_name || 'Unnamed Staff',
            phone: u.tcu_phone || '',
            email: u.tcu_email || '',
            auth_role: u.tcu_role,
            is_already_worker: existingUserIds.has(u.tcu_id)
        }));

        return reply.send({
            success: true,
            total_candidates: candidates.length,
            already_onboarded: candidates.filter(c => c.is_already_worker).length,
            candidates
        });
    }

    // 2. Fetch existing workers in zmanage to mark already-onboarded staff
    const { data: existingWorkers } = await supabase
        .schema('zmanage')
        .from('workers')
        .select('user_id, phone, email')
        .eq('project_id', projectId)
        .eq('deleted_flag', false);

    const existingUserIds = new Set((existingWorkers || []).map(w => w.user_id).filter(Boolean));
    const existingEmails = new Set((existingWorkers || []).map(w => w.email?.toLowerCase()).filter(Boolean));

    const candidates = (studioUsers || []).map(u => {
        const cleanEmail = u.email ? u.email.replace(`${clientId.substring(0, 8)}.`, '') : '';
        const isAlready = existingUserIds.has(u.id) || existingEmails.has(cleanEmail.toLowerCase()) || existingEmails.has(u.email?.toLowerCase());

        return {
            user_id: u.id,
            name: u.full_name || 'Staff Member',
            phone: '',
            email: cleanEmail,
            auth_role: u.role,
            is_already_worker: isAlready
        };
    });

    return reply.send({
        success: true,
        total_candidates: candidates.length,
        already_onboarded: candidates.filter(c => c.is_already_worker).length,
        candidates
    });
}

// 1-Tap Team Import: Step 2 - Batch Execute with Granular Control
export async function batchImportWorkers(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const { selected_users, default_worker_type, default_day_rate } = request.body as {
        selected_users: Array<{
            user_id?: string;
            name: string;
            phone: string;
            email?: string;
            primary_role: string;
            day_rate?: number;
            worker_type?: 'in_house' | 'freelance' | 'contractor';
        }>;
        default_worker_type?: 'in_house' | 'freelance' | 'contractor';
        default_day_rate?: number;
    };

    if (!selected_users || selected_users.length === 0) {
        return reply.code(400).send({ error: 'No users selected for import' });
    }

    const payload = selected_users.map(user => ({
        client_id: clientId,
        project_id: projectId,
        user_id: user.user_id || null,
        name: user.name,
        phone: user.phone,
        email: user.email || null,
        primary_role: user.primary_role || 'lead_photographer',
        worker_type: user.worker_type || default_worker_type || 'freelance',
        day_rate: user.day_rate !== undefined ? user.day_rate : (default_day_rate || 0),
        status: 'active'
    }));

    const { data, error } = await supabase
        .schema('zmanage')
        .from('workers')
        .insert(payload)
        .select();

    if (error) return reply.code(400).send({ error: error.message });

    return reply.code(201).send({
        success: true,
        imported_count: data?.length || 0,
        workers: data
    });
}

export async function deleteWorker(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
        .schema('zmanage')
        .from('workers')
        .update({
            deleted_flag: true,
            is_active: false,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    logAuditEvent(request, 'WORKER_REMOVED', 'WORKER', {
        worker_id: id,
        name: data.name,
        primary_role: data.primary_role
    });

    return reply.send({ success: true, message: 'Worker deleted successfully', worker: data });
}
