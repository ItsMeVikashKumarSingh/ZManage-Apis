import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';

export async function getProjectAnalytics(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;

    // Call high-performance database aggregation RPC
    const { data, error } = await supabase.rpc('fn_get_project_analytics', {
        p_project_id: projectId
    });

    if (error) {
        // Fallback manual aggregation if RPC is unavailable
        const [assetsRes, workersRes, allocsRes, payoutsRes] = await Promise.all([
            supabase
                .schema('zmanage')
                .from('assets')
                .select('category, status')
                .eq('project_id', projectId)
                .eq('deleted_flag', false),
            supabase
                .schema('zmanage')
                .from('workers')
                .select('status, worker_type')
                .eq('project_id', projectId)
                .eq('deleted_flag', false),
            supabase
                .schema('zmanage')
                .from('allocations')
                .select('status, start_time')
                .eq('project_id', projectId)
                .eq('deleted_flag', false),
            supabase
                .schema('zmanage')
                .from('worker_payouts')
                .select('total_amount, payout_status')
                .eq('project_id', projectId)
                .eq('deleted_flag', false)
        ]);

        const assets = assetsRes.data || [];
        const workers = workersRes.data || [];
        const allocs = allocsRes.data || [];
        const payouts = payoutsRes.data || [];

        const totalAssets = assets.length;
        const inUseAssets = assets.filter(a => a.status === 'on_shoot' || a.status === 'in_use').length;
        const availableAssets = assets.filter(a => a.status === 'available').length;
        const maintenanceAssets = assets.filter(a => a.status === 'maintenance' || a.status === 'in_repair').length;

        const catMap: Record<string, number> = {};
        assets.forEach(a => {
            const c = a.category || 'general';
            catMap[c] = (catMap[c] || 0) + 1;
        });

        let pendingPay = 0;
        let paidPay = 0;
        payouts.forEach(p => {
            const amt = Number(p.total_amount) || 0;
            if (p.payout_status === 'pending' || p.payout_status === 'approved') pendingPay += amt;
            if (p.payout_status === 'paid') paidPay += amt;
        });

        return reply.send({
            success: true,
            analytics: {
                total_assets: totalAssets,
                available_assets: availableAssets,
                in_use_assets: inUseAssets,
                maintenance_assets: maintenanceAssets,
                utilization_rate: totalAssets > 0 ? Math.round((inUseAssets / totalAssets) * 1000) / 10 : 0,
                total_workers: workers.length,
                active_workers: workers.filter(w => w.status === 'active').length,
                total_allocations: allocs.length,
                upcoming_allocations: allocs.filter(al => new Date(al.start_time) >= new Date() && al.status !== 'cancelled').length,
                pending_payouts: pendingPay,
                paid_payouts: paidPay,
                currency: 'INR',
                category_breakdown: catMap
            }
        });
    }

    return reply.send({ success: true, analytics: data });
}
