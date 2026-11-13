import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { budgetId, branchId, description, amountGhs, payee, requestedBy } = await req.json();

    // Enforce Rule 1: No budget = No approval
    const { data: budget } = await supabaseAdmin
      .from('budgets')
      .select('id, status, approved_amount_ghs')
      .eq('id', budgetId)
      .single();

    if (!budget || budget.status !== 'Approved') {
      return new Response(
        JSON.stringify({ error: 'Financial Gate Blocked (No Budget = No Approval): Linked budget must be Approved.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Enforce Rule 2: No accounts = No next funding (check overdue unsubmitted receipts > 7 days)
    if (branchId) {
      const today = new Date().toISOString().slice(0, 10);
      const { count: overdueCount } = await supabaseAdmin
        .from('expenditures')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId)
        .eq('receipt_submitted', false)
        .lt('receipt_due_date', today);

      if ((overdueCount ?? 0) > 0) {
        return new Response(
          JSON.stringify({ error: 'Financial Gate Blocked (No Accounts = No Next Funding): Overdue unsubmitted expense receipts exist for this branch.' }),
          { status: 400, headers: corsHeaders }
        );
      }
    }

    const due = new Date();
    due.setDate(due.getDate() + 7);

    const { data: exp, error } = await supabaseAdmin
      .from('expenditures')
      .insert({
        budget_id: budgetId,
        branch_id: branchId,
        description,
        amount_ghs: amountGhs,
        payee,
        receipt_due_date: due.toISOString().slice(0, 10),
        requested_by: requestedBy,
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, expenditure: exp }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400, headers: corsHeaders });
  }
});
