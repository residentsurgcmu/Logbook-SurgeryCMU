import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const allowedOrigins = new Set([
  "https://logbook-surgery-website.vercel.app",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://logbook-surgery-website.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, 405, { error: "Method not allowed" });

  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) return json(request, 403, { error: "Origin not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const authorization = request.headers.get("Authorization") || "";
    if (!supabaseUrl || !publishableKey || !serviceRoleKey || !authorization.startsWith("Bearer ")) {
      return json(request, 401, { error: "กรุณาเข้าสู่ระบบใหม่" });
    }

    const callerClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user?.email) return json(request, 401, { error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" });

    const { data: caller, error: profileError } = await callerClient
      .from("profiles")
      .select("id,email,role,active")
      .eq("id", userData.user.id)
      .single();
    if (profileError || caller?.role !== "admin" || !caller.active) {
      return json(request, 403, { error: "เฉพาะ Admin เท่านั้นที่ดำเนินการนี้ได้" });
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "delete_logbook");
    const password = String(body.password || "");
    const scope = String(body.scope || "");
    const studentId = String(body.studentId || "");
    const studentGroup = String(body.studentGroup || "");
    const curriculumId = String(body.curriculumId || "");
    const entryId = String(body.entryId || "");
    const studentIds = Array.isArray(body.studentIds) ? body.studentIds.map(String).filter(Boolean) : [];
    const studentFirstName = String(body.studentFirstName || "").trim();
    const studentLastName = String(body.studentLastName || "").trim();
    const studentCode = String(body.studentCode || "").trim();
    const studentEmail = String(body.studentEmail || "").trim().toLowerCase();
    const staffFirstName = String(body.staffFirstName || "").trim();
    const staffLastName = String(body.staffLastName || "").trim();
    const staffEmail = String(body.staffEmail || "").trim().toLowerCase();
    const staffAssignments: Array<Record<string, unknown>> = Array.isArray(body.staffAssignments)
      ? body.staffAssignments as Array<Record<string, unknown>>
      : [];
    if (!password) return json(request, 400, { error: "กรุณากรอกรหัสผ่าน Admin" });
    if (!new Set(["delete_logbook", "delete_avatars", "delete_logbook_entry", "delete_students", "upsert_student", "upsert_staff"]).has(action)) return json(request, 400, { error: "คำสั่งไม่ถูกต้อง" });
    if (new Set(["delete_logbook", "delete_avatars", "delete_logbook_entry"]).has(action)) {
      if (!new Set(["student", "group", "all"]).has(scope)) return json(request, 400, { error: "ขอบเขตการลบไม่ถูกต้อง" });
      if (action === "delete_avatars" && scope === "all") return json(request, 400, { error: "การลบรูปต้องเลือกนักศึกษารายคนหรือกลุ่ม Student" });
      if (scope === "student" && !studentId) return json(request, 400, { error: "กรุณาเลือกนักศึกษา" });
      if (scope === "group" && !studentGroup) return json(request, 400, { error: "กรุณาเลือกกลุ่มนักศึกษา" });
      if (action === "delete_logbook_entry" && !entryId) return json(request, 400, { error: "กรุณาเลือกรายการหัตถการ" });
    }
    if (action === "delete_students" && !studentIds.length) return json(request, 400, { error: "กรุณาเลือก Student ที่ต้องการลบ" });
    if (action === "upsert_student") {
      if (!studentFirstName || !studentLastName) return json(request, 400, { error: "กรุณากรอกชื่อและนามสกุล Student" });
      if (!/^[0-9]{6,20}$/.test(studentCode)) return json(request, 400, { error: "รหัสนักศึกษาต้องเป็นตัวเลข 6–20 หลัก" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) return json(request, 400, { error: "รูปแบบอีเมล Student ไม่ถูกต้อง" });
      if (!/^[0-9]{1,3}$/.test(studentGroup)) return json(request, 400, { error: "กลุ่ม Student ต้องเป็นตัวเลข 1–3 หลัก" });
      if (!curriculumId) return json(request, 400, { error: "กรุณาเลือกชั้นปีของ Student" });
    }
    if (action === "upsert_staff") {
      if (!staffFirstName || !staffLastName) return json(request, 400, { error: "กรุณากรอกชื่อและนามสกุล Staff" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffEmail)) return json(request, 400, { error: "รูปแบบอีเมล Staff ไม่ถูกต้อง" });
      if (!staffAssignments.length) return json(request, 400, { error: "กรุณาเลือก Curriculum และระบุหน่วย/สาขา" });
    }

    const passwordClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: passwordError } = await passwordClient.auth.signInWithPassword({
      email: caller.email,
      password,
    });
    if (passwordError) return json(request, 401, { error: "รหัสผ่าน Admin ไม่ถูกต้อง" });
    // Clear only this temporary in-memory session. A global sign-out would
    // revoke the Admin's active browser refresh token as well.
    await passwordClient.auth.signOut({ scope: "local" }).catch(() => {});

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (action === "upsert_student") {
      const fullName = `${studentFirstName} ${studentLastName}`.replace(/\s+/g, " ").trim();
      const { data: curriculum, error: curriculumError } = await adminClient
        .from("curricula").select("id,class_year,academic_year,name,status").eq("id", curriculumId).eq("status", "published").maybeSingle();
      if (curriculumError) throw curriculumError;
      if (!curriculum) return json(request, 400, { error: "ไม่พบ Curriculum ที่ Publish แล้วสำหรับชั้นปีนี้" });

      const [emailConflictResult, codeConflictResult] = await Promise.all([
        adminClient.from("profiles").select("id,email,student_code,role").eq("email", studentEmail),
        adminClient.from("profiles").select("id,email,student_code,role").eq("student_code", studentCode),
      ]);
      if (emailConflictResult.error) throw emailConflictResult.error;
      if (codeConflictResult.error) throw codeConflictResult.error;
      const conflictingProfiles = [...(emailConflictResult.data || []), ...(codeConflictResult.data || [])];
      const conflict = conflictingProfiles.find((profile) => profile.id !== studentId);
      if (conflict) {
        const duplicateField = conflict.email?.toLowerCase() === studentEmail ? "อีเมล" : "รหัสนักศึกษา";
        return json(request, 409, { error: `${duplicateField}นี้ถูกใช้โดยบัญชีอื่นแล้ว` });
      }

      let targetId = studentId;
      let created = false;
      if (studentId) {
        const { data: existingStudent, error: existingStudentError } = await adminClient
          .from("profiles").select("id,email,role").eq("id", studentId).eq("role", "student").maybeSingle();
        if (existingStudentError) throw existingStudentError;
        if (!existingStudent) return json(request, 404, { error: "ไม่พบบัญชี Student ที่ต้องการแก้ไข" });
        const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(studentId, {
          email: studentEmail,
          email_confirm: true,
          user_metadata: { requested_role: "student", full_name: fullName, student_code: studentCode, student_group: studentGroup },
        });
        if (authUpdateError) throw authUpdateError;
      } else {
        const randomBytes = crypto.getRandomValues(new Uint8Array(24));
        const temporaryPassword = `${Array.from(randomBytes, (value) => value.toString(16).padStart(2, "0")).join("")}Aa!`;
        const { data: createdUser, error: createUserError } = await adminClient.auth.admin.createUser({
          email: studentEmail,
          password: temporaryPassword,
          email_confirm: true,
          user_metadata: { requested_role: "student", full_name: fullName, student_code: studentCode, student_group: studentGroup },
        });
        if (createUserError || !createdUser.user) {
          const message = createUserError?.message?.toLowerCase().includes("already")
            ? "อีเมลนี้ยังมีบัญชี Auth อยู่ กรุณาแก้ไขบัญชีเดิมหรือลบให้สมบูรณ์ก่อนสมัครใหม่"
            : createUserError?.message || "สร้างบัญชี Student ไม่สำเร็จ";
          return json(request, 409, { error: message });
        }
        targetId = createdUser.user.id;
        created = true;
      }

      try {
        const { error: profileUpdateError } = await adminClient.from("profiles").update({
          email: studentEmail,
          full_name: fullName,
          student_code: studentCode,
          student_group: studentGroup,
          cohort_year: curriculum.academic_year,
          active: true,
        }).eq("id", targetId).eq("role", "student");
        if (profileUpdateError) throw profileUpdateError;

        const { error: archiveError } = await adminClient.from("student_enrollments")
          .update({ status: "archived", completed_at: new Date().toISOString() })
          .eq("student_id", targetId).eq("status", "active").neq("curriculum_id", curriculumId);
        if (archiveError) throw archiveError;
        const { error: enrollmentError } = await adminClient.from("student_enrollments").upsert({
          student_id: targetId,
          curriculum_id: curriculumId,
          group_code: studentGroup,
          status: "active",
          activated_at: new Date().toISOString(),
          completed_at: null,
          created_by: caller.id,
        }, { onConflict: "student_id,curriculum_id" });
        if (enrollmentError) throw enrollmentError;
      } catch (studentSaveError) {
        if (created && targetId) await adminClient.auth.admin.deleteUser(targetId, false).catch(() => {});
        throw studentSaveError;
      }

      let setupEmailSent = false;
      let setupEmailWarning = "";
      if (created) {
        const { error: resetError } = await passwordClient.auth.resetPasswordForEmail(studentEmail, {
          redirectTo: "https://logbook-surgery-website.vercel.app/reset-password",
        });
        setupEmailSent = !resetError;
        setupEmailWarning = resetError?.message || "";
      }
      return json(request, 200, {
        ok: true,
        created,
        setupEmailSent,
        setupEmailWarning,
        student: {
          id: targetId,
          name: fullName,
          email: studentEmail,
          studentCode,
          studentGroup,
          curriculumId,
          classYear: curriculum.class_year,
          academicYear: curriculum.academic_year,
        },
      });
    }
    if (action === "upsert_staff") {
      const fullName = `${staffFirstName} ${staffLastName}`.replace(/\s+/g, " ").trim();
      const normalizedAssignments = staffAssignments.map((assignment: Record<string, unknown>) => ({
        curriculum_id: String(assignment.curriculumId || ""),
        staff_email: staffEmail,
        unit_name: String(assignment.unitName || "").trim(),
        active: true,
      }));
      if (normalizedAssignments.some((assignment) => !assignment.curriculum_id || !assignment.unit_name)) {
        return json(request, 400, { error: "Curriculum หรือหน่วย/สาขาไม่ครบ" });
      }
      const curriculumIds = [...new Set(normalizedAssignments.map((assignment) => assignment.curriculum_id))];
      const { data: validCurricula, error: curriculaError } = await adminClient
        .from("curricula").select("id").in("id", curriculumIds).neq("status", "archived");
      if (curriculaError) throw curriculaError;
      if ((validCurricula || []).length !== curriculumIds.length) return json(request, 400, { error: "ไม่พบ Curriculum ที่เลือกหรือ Curriculum ถูกเก็บถาวรแล้ว" });

      const { data: existingProfile, error: existingProfileError } = await adminClient
        .from("profiles").select("id,role").eq("email", staffEmail).maybeSingle();
      if (existingProfileError) throw existingProfileError;
      if (existingProfile && existingProfile.role !== "staff") {
        return json(request, 409, { error: "อีเมลนี้ถูกใช้งานโดยบัญชีที่ไม่ใช่ Staff" });
      }
      const { error: directoryError } = await adminClient.from("user_directory").upsert({
        email: staffEmail, full_name: fullName, role: "staff", active: true,
      }, { onConflict: "email" });
      if (directoryError) throw directoryError;
      if (existingProfile) {
        const { error: staffProfileError } = await adminClient.from("profiles")
          .update({ full_name: fullName, active: true }).eq("id", existingProfile.id);
        if (staffProfileError) throw staffProfileError;
      }
      const { error: assignmentError } = await adminClient.from("curriculum_staff_approvers")
        .upsert(normalizedAssignments, { onConflict: "curriculum_id,staff_email" });
      if (assignmentError) throw assignmentError;
      return json(request, 200, {
        ok: true, staff: { email: staffEmail, name: fullName, assignments: normalizedAssignments },
        activationUrl: "https://logbook-surgery-website.vercel.app/?register=staff",
      });
    }
    if (action === "delete_students") {
      const uniqueStudentIds = [...new Set(studentIds)];
      const { data: targetStudents, error: targetStudentsError } = await adminClient
        .from("profiles").select("id,email,avatar_path").in("id", uniqueStudentIds).eq("role", "student");
      if (targetStudentsError) throw targetStudentsError;
      if ((targetStudents || []).length !== uniqueStudentIds.length) return json(request, 404, { error: "ไม่พบ Student บางบัญชีที่เลือก" });

      const paths = (targetStudents || []).map((student) => student.avatar_path).filter(Boolean);
      if (paths.length) {
        const { error: storageError } = await adminClient.storage.from("student-avatars").remove(paths);
        if (storageError) throw storageError;
      }
      for (const student of targetStudents || []) {
        const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(student.id, false);
        if (deleteUserError) throw deleteUserError;
      }
      return json(request, 200, {
        ok: true, deletedCount: (targetStudents || []).length,
        deletedAvatarCount: paths.length,
        emailsReusable: true,
      });
    }
    let targetStudentIds: string[] = [];
    let targetEnrollmentIds: string[] = [];
    let avatarPaths: string[] = [];
    if (scope === "student") {
      const { data: student, error } = await adminClient
        .from("profiles")
        .select("id,avatar_path")
        .eq("id", studentId)
        .eq("role", "student")
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      if (!student) return json(request, 404, { error: "ไม่พบนักศึกษาที่เลือก" });
      targetStudentIds = [student.id];
      avatarPaths = student.avatar_path ? [student.avatar_path] : [];
    } else if (scope === "group") {
      let enrollmentQuery = adminClient.from("student_enrollments").select("id,student_id").eq("group_code", studentGroup);
      if (curriculumId) enrollmentQuery = enrollmentQuery.eq("curriculum_id", curriculumId);
      else if (action === "delete_avatars") enrollmentQuery = enrollmentQuery.eq("status", "active");
      const { data: groupEnrollments, error: enrollmentError } = await enrollmentQuery;
      if (enrollmentError) throw enrollmentError;
      targetEnrollmentIds = (groupEnrollments || []).map((item) => item.id);
      targetStudentIds = [...new Set((groupEnrollments || []).map((item) => item.student_id))];
      if (!targetStudentIds.length) return json(request, 404, { error: "ไม่พบนักศึกษาในกลุ่มที่เลือก" });
      const { data: students, error } = await adminClient.from("profiles").select("id,avatar_path").in("id", targetStudentIds);
      if (error) throw error;
      avatarPaths = (students || []).map((student) => student.avatar_path).filter(Boolean);
    }

    if (action === "delete_logbook" && curriculumId && scope !== "group") {
      let enrollmentQuery = adminClient.from("student_enrollments").select("id").eq("curriculum_id", curriculumId);
      if (scope === "student") enrollmentQuery = enrollmentQuery.eq("student_id", studentId);
      const { data: scopedEnrollments, error: enrollmentError } = await enrollmentQuery;
      if (enrollmentError) throw enrollmentError;
      targetEnrollmentIds = (scopedEnrollments || []).map((item) => item.id);
      if (!targetEnrollmentIds.length) return json(request, 404, { error: "ไม่พบ Enrollment ใน Curriculum ที่เลือก" });
    }

    if (action === "delete_avatars") {
      let removedCount = 0;
      if (avatarPaths.length) {
        const { data: removed, error: storageError } = await adminClient.storage.from("student-avatars").remove(avatarPaths);
        if (storageError) throw storageError;
        removedCount = removed?.length || 0;

        const { error: profileUpdateError } = await adminClient
          .from("profiles")
          .update({ avatar_path: null })
          .in("id", targetStudentIds);
        if (profileUpdateError) throw profileUpdateError;
      }
      return json(request, 200, {
        ok: true,
        deletedCount: removedCount,
        clearedCount: avatarPaths.length,
        scope,
        studentCount: targetStudentIds.length,
      });
    }

    if (action === "delete_logbook_entry") {
      const { data: deleted, error: deleteError } = await adminClient
        .from("year4_logbook_entries")
        .delete()
        .eq("id", entryId)
        .eq("student_id", studentId)
        .select("id");
      if (deleteError) throw deleteError;
      if (!deleted?.length) return json(request, 404, { error: "ไม่พบหัตถการของนักศึกษาที่เลือก" });
      return json(request, 200, { ok: true, deletedCount: deleted.length, scope, studentCount: 1 });
    }

    let deleteQuery = adminClient.from("year4_logbook_entries").delete();
    if (targetEnrollmentIds.length) deleteQuery = deleteQuery.in("enrollment_id", targetEnrollmentIds);
    else if (scope === "student" || scope === "group") deleteQuery = deleteQuery.in("student_id", targetStudentIds);
    else deleteQuery = deleteQuery.not("id", "is", null);
    const { data: deleted, error: deleteError } = await deleteQuery.select("id");
    if (deleteError) throw deleteError;

    return json(request, 200, {
      ok: true,
      deletedCount: deleted?.length || 0,
      scope,
      studentCount: scope === "all" ? null : targetStudentIds.length,
    });
  } catch (error) {
    console.error("Admin data operation failed", error);
    return json(request, 500, { error: `ดำเนินการไม่สำเร็จ: ${error instanceof Error ? error.message : "Unknown error"}` });
  }
});
