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
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: corsHeaders });

    const { data: canApprove } = await supabaseUser.rpc('has_permission', { p_module: 'applications', p_action: 'approve' });
    if (!canApprove) return new Response(JSON.stringify({ error: 'Forbidden: Missing approval permission' }), { status: 403, headers: corsHeaders });

    const { applicationId, decision, comments } = await req.json();
    const { data: app, error: appErr } = await supabaseAdmin
      .from('membership_applications')
      .select('*, branches:preferred_branch_id(code)')
      .eq('id', applicationId)
      .single();

    if (appErr || !app) return new Response(JSON.stringify({ error: 'Application not found' }), { status: 404, headers: corsHeaders });

    const { data: officer } = await supabaseAdmin.from('members').select('id').eq('auth_user_id', user.id).single();

    if (decision === 'Approved') {
      const branchCode = (app.branches as { code: string })?.code ?? 'GN';
      const { count } = await supabaseAdmin.from('members').select('id', { count: 'exact', head: true });
      const seq = String((count ?? 0) + 1).padStart(4, '0');
      const membershipNumber = `LSP-${branchCode}-${seq}`;
      const qrToken = crypto.randomUUID().replace(/-/g, '');

      const { data: member, error: memErr } = await supabaseAdmin
        .from('members')
        .insert({
          membership_number: membershipNumber,
          qr_token: qrToken,
          full_name: app.full_name,
          date_of_birth: app.date_of_birth,
          gender: app.gender,
          telephone: app.telephone,
          email: app.email,
          residential_address: app.residential_address,
          photo_storage_path: app.photo_storage_path,
          branch_id: app.preferred_branch_id,
          subdivision_id: app.preferred_subdivision_id,
          category_id: app.requested_category_id,
          membership_status: 'Active',
          previous_experience: app.previous_experience,
          emergency_contact_name: app.emergency_contact_name,
          emergency_contact_phone: app.emergency_contact_phone,
          approved_by: officer?.id ?? null,
          approved_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (memErr) throw memErr;

      await supabaseAdmin
        .from('membership_applications')
        .update({
          status: 'Approved',
          reviewing_officer_id: officer?.id ?? null,
          reviewed_at: new Date().toISOString(),
          review_comments: comments,
          approved_member_id: member.id,
        })
        .eq('id', applicationId);

      await supabaseAdmin.from('application_decision_history').insert({
        application_id: applicationId,
        previous_status: app.status,
        new_status: 'Approved',
        actor_member_id: officer?.id ?? null,
        notes: comments ?? 'Approved via Edge Function',
      });

      return new Response(JSON.stringify({ success: true, member }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabaseAdmin
      .from('membership_applications')
      .update({
        status: decision,
        reviewing_officer_id: officer?.id ?? null,
        reviewed_at: new Date().toISOString(),
        review_comments: comments,
      })
      .eq('id', applicationId);

    await supabaseAdmin.from('application_decision_history').insert({
      application_id: applicationId,
      previous_status: app.status,
      new_status: decision,
      actor_member_id: officer?.id ?? null,
      notes: comments,
    });

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 400, headers: corsHeaders });
  }
});
