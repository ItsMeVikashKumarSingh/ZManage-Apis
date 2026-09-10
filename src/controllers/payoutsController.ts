import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';

export async function listPayouts(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { status, worker_id } = request.query as { status?: string; worker_id?: string };

    let query = supabase
        .schema('zresource')
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
        .schema('zresource')
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
    return reply.send({ success: true, message: 'Payout settled successfully', payout: data });
}

export async function getPayoutsSummary(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;

    const { data, error } = await supabase
        .schema('zresource')
        .from('worker_payouts')
        .select('total_amount, payout_status')
        .eq('project_id', projectId)
        .eq('deleted_flag', false);

    if (error) return reply.code(500).send({ error: error.message });

    let pendingTotal = 0;
    let paidTotal = 0;

    (data || []).forEach(p => {
        const amount = Number(p.total_amount) || 0;
        if (p.payout_status === 'pending' || p.payout_status === 'approved') {
            pendingTotal += amount;
        } else if (p.payout_status === 'paid') {
            paidTotal += amount;
        }
    });

    return reply.send({
        success: true,
        summary: {
            pending_total: pendingTotal,
            paid_total: paidTotal,
            currency: 'INR'
        }
    });
}
