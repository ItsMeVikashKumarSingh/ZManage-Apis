export interface Asset {
    id: string;
    client_id: string;
    project_id: string;
    name: string;
    code?: string;
    category: 'camera' | 'lens' | 'drone' | 'lighting' | 'audio' | 'gimbal' | 'space' | 'accessory';
    serial_number?: string;
    condition: 'excellent' | 'good' | 'fair' | 'damaged' | 'in_repair';
    status: 'available' | 'on_shoot' | 'maintenance' | 'retired' | 'lost';
    purchase_date?: string;
    purchase_cost?: number;
    currency: string;
    image_url?: string;
    specs: Record<string, any>;
    maintenance_notes?: string;
    is_active: boolean;
    deleted_flag: boolean;
    created_at: string;
    updated_at: string;
}

export interface Worker {
    id: string;
    client_id: string;
    project_id: string;
    user_id?: string;
    name: string;
    phone: string;
    email?: string;
    primary_role: string;
    skills: string[];
    worker_type: 'in_house' | 'freelance' | 'contractor';
    day_rate: number;
    half_day_rate: number;
    overtime_hourly_rate: number;
    currency: string;
    payment_details: {
        upi_id?: string;
        bank_account?: string;
        ifsc?: string;
    };
    status: 'active' | 'on_leave' | 'inactive';
    is_active: boolean;
    deleted_flag: boolean;
    created_at: string;
    updated_at: string;
}

export interface Allocation {
    id: string;
    client_id: string;
    project_id: string;
    title: string;
    client_name?: string;
    client_phone?: string;
    venue?: string;
    start_time: string;
    end_time: string;
    status: 'tentative' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
    notes?: string;
    deleted_flag: boolean;
    created_at: string;
    updated_at: string;
}

export interface AssetLock {
    id: string;
    client_id: string;
    project_id: string;
    asset_id: string;
    allocation_id: string;
    lock_start: string;
    lock_end: string;
    buffer_minutes: number;
    status: 'locked' | 'checked_out' | 'returned' | 'released';
    checked_out_at?: string;
    checked_in_at?: string;
    return_condition?: string;
    deleted_flag: boolean;
    created_at: string;
    updated_at: string;
}

export interface WorkerShift {
    id: string;
    client_id: string;
    project_id: string;
    worker_id: string;
    allocation_id: string;
    assigned_role: string;
    call_time: string;
    wrap_time: string;
    attendance_status: 'scheduled' | 'confirmed' | 'checked_in' | 'wrap_done' | 'no_show';
    agreed_pay: number;
    notes?: string;
    deleted_flag: boolean;
    created_at: string;
    updated_at: string;
}

export interface WorkerPayout {
    id: string;
    client_id: string;
    project_id: string;
    worker_id: string;
    shift_id?: string;
    allocation_id?: string;
    base_amount: number;
    overtime_amount: number;
    bonus_or_deduction: number;
    total_amount: number;
    currency: string;
    payout_status: 'pending' | 'approved' | 'paid' | 'cancelled';
    payment_mode?: 'upi' | 'bank_transfer' | 'cash' | 'gateway';
    reference_number?: string;
    paid_at?: string;
    paid_by?: string;
    notes?: string;
    deleted_flag: boolean;
    created_at: string;
    updated_at: string;
}

export interface TenantContext {
    clientId: string;
    projectId: string;
    channel: 'MANAGED' | 'CUSTOM_API' | 'CUSTOM_MOBILE';
}
