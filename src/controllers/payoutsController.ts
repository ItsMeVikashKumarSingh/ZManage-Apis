import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';
import { logAuditEvent } from '../utils/auditLogger';

export async function listPayouts(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { status, worker_id } = request.query as { status?: string; worker_id?: string };

    let query = supabase
        .schema('zmanage')
        .from('worker_payouts')
        .select(`
            *,
            workers (name, phone, primary_role, payment_details),
            allocations (title, start_time, venue)
        `)
        .eq('project_id', projectId)
        .eq('deleted_flag', false)
        .order('created_at', { ascending: false });

    if (status) query = query.eq('payout_status', status);
    if (worker_id) query = query.eq('worker_id', worker_id);

    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });

    return reply.send({ success: true, count: data?.length || 0, payouts: data });
}

export async function settlePayout(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const { payment_mode, reference_number, notes } = request.body as {
        payment_mode: 'upi' | 'bank_transfer' | 'cash' | 'gateway';
        reference_number: string;
        notes?: string;
    };

    const { data, error } = await supabase
        .schema('zmanage')
        .from('worker_payouts')
        .update({
            payout_status: 'paid',
            payment_mode,
            reference_number,
            notes,
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    logAuditEvent(request, 'PAYOUT_SETTLED', 'PAYOUT', {
        payout_id: id,
        total_amount: data.total_amount,
        payment_mode,
        reference_number,
        paid_at: data.paid_at
    });

    return reply.send({ success: true, message: 'Payout settled successfully', payout: data });
}

export async function getPayoutsSummary(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;

    const { data, error } = await supabase
        .schema('zmanage')
        .from('worker_payouts')
        .select('total_amount, payout_status')
        .eq('project_id', projectId)
        .eq('deleted_flag', false);

    if (error) return reply.code(500).send({ error: error.message });

    let pendingTotal = 0;
    let paidTotal = 0;
    let pendingCount = 0;
    let settledCount = 0;

    (data || []).forEach(p => {
        const amount = Number(p.total_amount) || 0;
        if (p.payout_status === 'pending' || p.payout_status === 'approved') {
            pendingTotal += amount;
            pendingCount++;
        } else if (p.payout_status === 'paid' || p.payout_status === 'settled') {
            paidTotal += amount;
            settledCount++;
        }
    });

    return reply.send({
        success: true,
        summary: {
            pending_total: pendingTotal,
            settled_total: paidTotal,
            paid_total: paidTotal,
            pending_count: pendingCount,
            settled_count: settledCount,
            currency: 'INR'
        }
    });
}

export async function createPayout(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const body = request.body as {
        worker_id: string;
        allocation_id?: string;
        base_amount?: number;
        overtime_amount?: number;
        bonus_or_deduction?: number;
        total_amount: number;
        currency?: string;
        payout_status?: 'pending' | 'approved' | 'paid';
        payment_mode?: 'upi' | 'bank_transfer' | 'cash' | 'gateway';
        reference_number?: string;
        notes?: string;
    };

    const { data, error } = await supabase
        .schema('zmanage')
        .from('worker_payouts')
        .insert({
            client_id: clientId,
            project_id: projectId,
            worker_id: body.worker_id,
            allocation_id: body.allocation_id || null,
            base_amount: body.base_amount || body.total_amount,
            overtime_amount: body.overtime_amount || 0,
            bonus_or_deduction: body.bonus_or_deduction || 0,
            total_amount: body.total_amount,
            currency: body.currency || 'INR',
            payout_status: body.payout_status || 'pending',
            payment_mode: body.payment_mode || null,
            reference_number: body.reference_number || null,
            notes: body.notes || null,
            paid_at: body.payout_status === 'paid' ? new Date().toISOString() : null
        })
        .select(`
            *,
            workers (name, phone, primary_role, payment_details)
        `)
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    logAuditEvent(request, 'PAYOUT_LOGGED', 'PAYOUT', {
        payout_id: data.id,
        worker_id: data.worker_id,
        total_amount: data.total_amount,
        payout_status: data.payout_status,
        currency: data.currency
    });

    return reply.code(201).send({ success: true, payout: data });
}
