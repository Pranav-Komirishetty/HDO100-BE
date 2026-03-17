import express, { Request, Response } from "express";
import { supabase } from "../db/supabaseClient";
import { authenticate } from "../middleware/authMiddleware";
import { getEffectiveDate } from "../utils/dateUtils";

const router = express.Router();

//to create a challenge
router.post("/", authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { name, tasks } = req.body;

  if (!name || !tasks || tasks.length < 1) {
    return res.status(400).json({ message: "Invalid challenge data" });
  }

  // const totalPoints = tasks.reduce((sum: number, t: any) => sum + t.points, 0);

  // if (totalPoints !== 100) {
  //   return res.status(400).json({ message: "Total points must equal 100" });
  // }

  if (!name || typeof name !== "string" || name.trim().length < 3) {
    return res.status(400).json({
      message: "Challenge name must be at least 3 characters",
    });
  }

  try {
    // Get user timezone
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, timezone")
      .eq("email", user.email)
      .single();

    if (userError) throw userError;

    const { data: challenge, error } = await supabase
      .from("challenges")
      .insert({
        user_id: userData.id,
        name,
        timezone_snapshot: userData.timezone,
        status: "draft",
      })
      .select()
      .single();

    if (error) throw error;

    const tasksToInsert = tasks.map((t: any, index: number) => ({
      challenge_id: challenge.id,
      task_name: t.task_name,
      points: t.points,
      order_index: index + 1,
    }));

    await supabase.from("challenge_tasks").insert(tasksToInsert);

    res.status(201).json({
      message: "Challenge created successfully",
      challenge,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

//to updated a challenge
router.put("/:id", authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const challengeId = req.params.id as string;

  const { name, tasks } = req.body;

  if (!name || typeof name !== "string" || name.trim().length < 3) {
    return res.status(400).json({
      message: "Challenge name must be at least 3 characters",
    });
  }

  try {
    // 1️⃣ Get user
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", user.email)
      .single();

    if (userError) throw userError;

    // 2️⃣ Get challenge
    const { data: challenge, error: challengeError } = await supabase
      .from("challenges")
      .select("*")
      .eq("id", challengeId)
      .eq("user_id", userData.id)
      .single();

    if (challengeError || !challenge) {
      return res.status(404).json({ message: "Challenge not found" });
    }

    // 3️⃣ Only draft editable
    if (challenge.status !== "draft") {
      return res.status(400).json({
        message: "Only draft challenges can be modified",
      });
    }

    // 4️⃣ Validate tasks
    if (!Array.isArray(tasks) || tasks.length < 1) {
      return res.status(400).json({
        message: "Draft must contain at least one task",
      });
    }

    const titles = new Set<string>();

    for (const task of tasks) {
      if (!task.task_name || typeof task.task_name !== "string") {
        return res.status(400).json({
          message: "Invalid task name",
        });
      }

      if (
        typeof task.points !== "number" ||
        task.points < 1 ||
        task.points > 10
      ) {
        return res.status(400).json({
          message: "Task points must be between 1 and 10",
        });
      }

      if (titles.has(task.task_name.trim().toLowerCase())) {
        return res.status(400).json({
          message: "Duplicate task names are not allowed",
        });
      }

      titles.add(task.task_name.trim().toLowerCase());
    }

    // 5️⃣ Update challenge name
    const { error: updateError } = await supabase
      .from("challenges")
      .update({ name })
      .eq("id", challengeId);

    if (updateError) throw updateError;

    // 6️⃣ Delete existing tasks
    const { error: deleteError } = await supabase
      .from("challenge_tasks")
      .delete()
      .eq("challenge_id", challengeId);

    if (deleteError) throw deleteError;

    // 7️⃣ Insert new tasks
    const formattedTasks = tasks.map((task: any, index: number) => ({
      challenge_id: challengeId,
      task_name: task.task_name.trim(),
      points: task.points,
      order_index: index + 1,
    }));

    const { error: insertError } = await supabase
      .from("challenge_tasks")
      .insert(formattedTasks);

    if (insertError) throw insertError;

    res.json({
      message: "Draft updated successfully",
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

//to start the created challenge
router.post("/:id/start", authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const challengeId = req.params.id as string;

  try {
    // 1️⃣ Get user
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", user.email)
      .single();

    if (userError) throw userError;

    // 2️⃣ Get challenge
    const { data: challenge, error: challengeError } = await supabase
      .from("challenges")
      .select("*")
      .eq("id", challengeId)
      .eq("user_id", userData.id)
      .single();

    if (challengeError || !challenge) {
      return res.status(404).json({ message: "Challenge not found" });
    }

    // 3️⃣ Must be draft
    if (challenge.status !== "draft") {
      return res.status(400).json({
        message: "Only draft challenges can be started",
      });
    }

    // 4️⃣ Get tasks
    const { data: tasks, error: taskError } = await supabase
      .from("challenge_tasks")
      .select("*")
      .eq("challenge_id", challengeId);

    if (taskError) throw taskError;

    if (!tasks || tasks.length < 10) {
      return res.status(400).json({
        message: "Challenge must have at least 10 tasks to start",
      });
    }

    // 5️⃣ Validate total points = 100
    const totalPoints = tasks.reduce(
      (sum: number, task: any) => sum + task.points,
      0,
    );

    if (totalPoints !== 100) {
      return res.status(400).json({
        message: "Total task points must equal 100 to start challenge",
      });
    }

    // 6️⃣ Duplicate title safety check (extra protection)
    const titleSet = new Set<string>();
    for (const task of tasks) {
      const normalized = task.task_name.trim().toLowerCase();
      if (titleSet.has(normalized)) {
        return res.status(400).json({
          message: "Duplicate task titles detected",
        });
      }
      titleSet.add(normalized);
    }

    // 7️⃣ Calculate start + end dates (using your timezone-safe logic)
    const effectiveToday = getEffectiveDate(challenge.timezone_snapshot);

    const startDateObj = new Date(effectiveToday);
    startDateObj.setDate(startDateObj.getDate() + 1);

    const startDate = startDateObj.toISOString().split("T")[0];

    const endDateObj = new Date(startDate);
    endDateObj.setDate(endDateObj.getDate() + 99);

    const endDate = endDateObj.toISOString().split("T")[0];

    // 8️⃣ Activate challenge
    const { error: updateError } = await supabase
      .from("challenges")
      .update({
        status: "active",
        start_date: startDate,
        end_date: endDate,
      })
      .eq("id", challengeId);

    if (updateError) throw updateError;

    res.json({
      message: "Challenge started successfully",
      start_date: startDate,
      end_date: endDate,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

//to set a challenge a dashboard default
router.post(
  "/:id/default",
  authenticate,
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const challengeId = req.params.id;

    try {
      // Get user id
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("email", user.email)
        .single();

      if (userError) throw userError;

      // Verify challenge belongs to user
      const { data: challenge, error: challengeError } = await supabase
        .from("challenges")
        .select("id, status")
        .eq("id", challengeId)
        .eq("user_id", userData.id)
        .single();

      if (challengeError || !challenge) {
        return res.status(404).json({ message: "Challenge not found" });
      }

      // 🔥 New validation
      if (challenge.status !== "active") {
        return res.status(400).json({
          message: "Only active challenges can be set as default",
        });
      }

      // Remove default from all user's challenges
      await supabase
        .from("challenges")
        .update({ is_default: false })
        .eq("user_id", userData.id);

      // Set selected challenge as default
      const { data: updated, error: updateError } = await supabase
        .from("challenges")
        .update({ is_default: true })
        .eq("id", challengeId)
        .select()
        .single();

      if (updateError) throw updateError;

      res.json({
        message: "Default challenge updated",
        challenge: updated,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  },
);

//to delete a draft challenge
router.delete("/:id", authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const challengeId = req.params.id;

  try {
    // Get user id
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", user.email)
      .single();

    if (userError) throw userError;

    // Get challenge
    const { data: challenge, error: challengeError } = await supabase
      .from("challenges")
      .select("id, status")
      .eq("id", challengeId)
      .eq("user_id", userData.id)
      .single();

    if (challengeError || !challenge) {
      return res.status(404).json({ message: "Challenge not found" });
    }

    // 🔥 Only draft allowed
    if (challenge.status !== "draft") {
      return res.status(400).json({
        message: "Only draft challenges can be deleted",
      });
    }

    // Delete (cascade removes tasks automatically)
    const { error: deleteError } = await supabase
      .from("challenges")
      .delete()
      .eq("id", challengeId);

    if (deleteError) throw deleteError;

    res.json({ message: "Draft challenge deleted successfully" });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

//to get challenges
router.get("/", authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user;

  try {
    // Get user id
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", user.email)
      .single();

    if (userError) throw userError;

    const statusFilter = req.query.status as string | undefined;

    let query = supabase
      .from("challenges")
      .select("*")
      .eq("user_id", userData.id);

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data: challenges, error } = await query
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    type ChallengeStatus = "active" | "draft" | "completed";

    const order: Record<ChallengeStatus, number> = {
      active: 1,
      draft: 2,
      completed: 3,
    };

    const sorted = challenges.sort((a, b) => {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;

      const statusA = a.status as ChallengeStatus;
      const statusB = b.status as ChallengeStatus;

      if (order[statusA] !== order[statusB]) {
        return order[statusA] - order[statusB];
      }

      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });

    res.json({ challenges: sorted });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

//to get challenge details
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const challengeId = req.params.id as string;

  try {
    // 1️⃣ Get user
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", user.email)
      .single();

    if (userError) throw userError;

    // 2️⃣ Get challenge
    const { data: challenge, error: challengeError } = await supabase
      .from("challenges")
      .select("*")
      .eq("id", challengeId)
      .eq("user_id", userData.id)
      .single();

    if (challengeError || !challenge) {
      return res.status(404).json({ message: "Challenge not found" });
    }

    // 3️⃣ Get tasks
    const { data: tasksData, error: taskError } = await supabase
      .from("challenge_tasks")
      .select("*")
      .eq("challenge_id", challengeId)
      .order("order_index", { ascending: true });

    if (taskError) throw taskError;

    const tasks = tasksData ?? [];

    await ensureDailyLogsExist(challenge, tasks, challengeId);

    let currentDay: number | null = null;
    let performanceMap: Record<string, number> = {};

    if (challenge.status === "active") {
      const effectiveToday = getEffectiveDate(challenge.timezone_snapshot);

      const start = new Date(challenge.start_date);
      const today = new Date(effectiveToday);

      const diffTime = today.getTime() - start.getTime();
      currentDay = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

      if (currentDay < 1) currentDay = 0;
      if (currentDay > 100) currentDay = 100;

      // 🔥 Correct log query
      if (currentDay > 0) {
        const { data: logs } = await supabase
          .from("daily_logs")
          .select("id")
          .eq("challenge_id", challengeId)
          .lte("date_local", effectiveToday); // ✅ FIXED

        const logIds = logs?.map((l) => l.id) ?? [];

        if (logIds.length > 0) {
          const { data: taskLogs } = await supabase
            .from("daily_task_logs")
            .select("task_id, completed")
            .in("daily_log_id", logIds);

          const completedCount: Record<string, number> = {};

          for (const tl of taskLogs ?? []) {
            if (tl.completed) {
              completedCount[tl.task_id] =
                (completedCount[tl.task_id] || 0) + 1;
            }
          }

          for (const task of tasks) {
            const completed = completedCount[task.id] || 0;

            performanceMap[task.id] = Math.round(
              (completed / currentDay) * 100,
            );
          }
        }
      }
    }

    const enrichedTasks = tasks.map((task) => ({
      ...task,
      performance_percentage: performanceMap[task.id] ?? 0,
    }));

    res.json({
      ...challenge,
      current_day: currentDay,
      tasks: enrichedTasks,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

//to get todays task
router.get("/:id/today", authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const challengeId = req.params.id;

  try {
    // 1️⃣ Get user id
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, timezone")
      .eq("email", user.email)
      .single();

    if (userError) throw userError;

    // 2️⃣ Get challenge
    const { data: challenge, error: challengeError } = await supabase
      .from("challenges")
      .select("*")
      .eq("id", challengeId)
      .eq("user_id", userData.id)
      .single();

    if (challengeError || !challenge) {
      return res.status(404).json({ message: "Challenge not found" });
    }

    // 3️⃣ Must be active
    if (challenge.status !== "active") {
      return res.status(400).json({
        message: "Challenge has not started",
      });
    }

    // 4️⃣ Calculate effective date (2AM rule)
    const effectiveDate = getEffectiveDate(challenge.timezone_snapshot);

    // 5️⃣ Range validation
    if (effectiveDate < challenge.start_date) {
      return res.status(400).json({
        message: "Challenge not started yet",
      });
    }

    if (effectiveDate > challenge.end_date) {
      return res.status(400).json({
        message: "Challenge completed",
      });
    }

    // 6️⃣ Calculate day number
    const start = new Date(challenge.start_date);
    const today = new Date(effectiveDate);

    const diffTime = today.getTime() - start.getTime();
    const dayNumber = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // 7️⃣ Get tasks
    const { data: tasks, error: taskError } = await supabase
      .from("challenge_tasks")
      .select("*")
      .eq("challenge_id", challengeId)
      .order("order_index", { ascending: true });

    if (taskError) throw taskError;

    // 8️⃣ Check if daily log exists
    const { data: dailyLog } = await supabase
      .from("daily_logs")
      .select("*")
      .eq("challenge_id", challengeId)
      .eq("date_local", effectiveDate)
      .single();

    let taskStates: any[] = [];

    if (!dailyLog) {
      // No log yet → all tasks incomplete
      taskStates = tasks.map((task: any) => ({
        task_id: task.id,
        task_name: task.task_name,
        points: task.points,
        completed: false,
      }));
    } else {
      const { data: taskLogs } = await supabase
        .from("daily_task_logs")
        .select("*")
        .eq("daily_log_id", dailyLog.id);

      taskStates = tasks.map((task: any) => {
        const existing = taskLogs?.find((t: any) => t.task_id === task.id);

        return {
          task_id: task.id,
          task_name: task.task_name,
          points: task.points,
          completed: existing ? existing.completed : false,
        };
      });
    }

    res.json({
      challenge: {
        id: challenge.id,
        name: challenge.name,
      },
      date: effectiveDate,
      dayNumber,
      tasks: taskStates,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

//to mark completed tasks and auto fill missing days
router.post("/:id/log", authenticate, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const challengeId = req.params.id;
  const { tasks } = req.body;

  try {
    // 1️⃣ Get user + timezone
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, timezone")
      .eq("email", user.email)
      .single();

    if (userError) throw userError;

    // 2️⃣ Get challenge
    const { data: challenge, error: challengeError } = await supabase
      .from("challenges")
      .select("*")
      .eq("id", challengeId)
      .eq("user_id", userData.id)
      .single();

    if (challengeError || !challenge) {
      return res.status(404).json({ message: "Challenge not found" });
    }

    if (challenge.status !== "active") {
      return res.status(400).json({ message: "Challenge not active" });
    }

    const effectiveDate = getEffectiveDate(challenge.timezone_snapshot);

    if (effectiveDate < challenge.start_date) {
      return res.status(400).json({ message: "Challenge not started yet" });
    }

    if (effectiveDate > challenge.end_date) {
      return res.status(400).json({ message: "Challenge completed" });
    }

    // 3️⃣ GAP FILL
    /*const { data: existingLogs } = await supabase
      .from("daily_logs")
      .select("date_local")
      .eq("challenge_id", challengeId)
      .order("date_local", { ascending: true });

    const loggedDates = existingLogs?.map((l) => l.date_local) || [];

    const start = new Date(challenge.start_date);
    const today = new Date(effectiveDate);

    for (let d = new Date(start); d < today; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];

      if (!loggedDates.includes(dateStr)) {
        const { data: newLog } = await supabase
          .from("daily_logs")
          .insert({
            challenge_id: challengeId,
            date_local: dateStr,
            total_score: 0,
            is_logged_by_user: false,
          })
          .select()
          .single();

        const { data: challengeTasks } = await supabase
          .from("challenge_tasks")
          .select("*")
          .eq("challenge_id", challengeId);

        if (challengeTasks) {
          const insertTasks = challengeTasks.map((t) => ({
            daily_log_id: newLog.id,
            task_id: t.id,
            completed: false,
            score_awarded: 0,
          }));

          await supabase.from("daily_task_logs").insert(insertTasks);
        }
      }
    }*/

    const { data: challengeTasks } = await supabase
      .from("challenge_tasks")
      .select("*")
      .eq("challenge_id", challengeId);

    await ensureDailyLogsExist(
      challenge,
      challengeTasks || [],
      challengeId as string,
    );
    // 4️⃣ Handle Today Log
    let { data: dailyLog } = await supabase
      .from("daily_logs")
      .select("*")
      .eq("challenge_id", challengeId)
      .eq("date_local", effectiveDate)
      .single();

    if (!dailyLog) {
      const { data: newLog } = await supabase
        .from("daily_logs")
        .insert({
          challenge_id: challengeId,
          date_local: effectiveDate,
          total_score: 0,
          is_logged_by_user: true,
        })
        .select()
        .single();

      dailyLog = newLog;

      const { data: challengeTasks } = await supabase
        .from("challenge_tasks")
        .select("*")
        .eq("challenge_id", challengeId);

      if (challengeTasks) {
        const insertTasks = challengeTasks.map((t) => ({
          daily_log_id: dailyLog.id,
          task_id: t.id,
          completed: false,
          score_awarded: 0,
        }));

        await supabase.from("daily_task_logs").insert(insertTasks);
      }
    }

    // 5️⃣ Update task completions (true only upgrade)
    const { data: taskLogs } = await supabase
      .from("daily_task_logs")
      .select("*")
      .eq("daily_log_id", dailyLog.id);

    let totalScore = 0;

    for (const task of taskLogs || []) {
      const incoming = tasks.find((t: any) => t.task_id === task.task_id);

      const newCompleted = task.completed || incoming?.completed;

      const { data: challengeTask } = await supabase
        .from("challenge_tasks")
        .select("points")
        .eq("id", task.task_id)
        .single();

      const points = challengeTask?.points || 0;
      const score = newCompleted ? points : 0;

      totalScore += score;

      await supabase
        .from("daily_task_logs")
        .update({
          completed: newCompleted,
          score_awarded: score,
        })
        .eq("id", task.id);
    }

    await supabase
      .from("daily_logs")
      .update({
        total_score: totalScore,
        is_logged_by_user: true,
      })
      .eq("id", dailyLog.id);

    res.json({
      message: "Log saved successfully",
      total_score: totalScore,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

//to get day details
router.get(
  "/:id/day/:date",
  authenticate,
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const challengeId = req.params.id;
    const requestedDate = req.params.date as string;

    try {
      // 1️⃣ Get user
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("email", user.email)
        .single();

      if (userError) throw userError;

      // 2️⃣ Get challenge
      const { data: challenge, error: challengeError } = await supabase
        .from("challenges")
        .select("*")
        .eq("id", challengeId)
        .eq("user_id", userData.id)
        .single();

      if (challengeError || !challenge) {
        return res.status(404).json({ message: "Challenge not found" });
      }

      if (challenge.status !== "active") {
        return res.status(400).json({ message: "Challenge not active" });
      }

      // 3️⃣ Range validation
      if (requestedDate < challenge.start_date) {
        return res.status(400).json({ message: "Date before challenge start" });
      }

      if (requestedDate > challenge.end_date) {
        return res.status(400).json({ message: "Date after challenge end" });
      }

      // 4️⃣ Get effective today
      const effectiveToday = getEffectiveDate(challenge.timezone_snapshot);

      if (requestedDate > effectiveToday) {
        return res.status(400).json({ message: "Future date not allowed" });
      }

      // 5️⃣ Calculate day number
      const start = new Date(challenge.start_date);
      const day = new Date(requestedDate);
      const diffTime = day.getTime() - start.getTime();
      const dayNumber = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

      // 6️⃣ Get tasks
      const { data: tasks } = await supabase
        .from("challenge_tasks")
        .select("*")
        .eq("challenge_id", challengeId)
        .order("order_index", { ascending: true });

      // 7️⃣ Check if log exists
      const { data: dailyLog } = await supabase
        .from("daily_logs")
        .select("*")
        .eq("challenge_id", challengeId)
        .eq("date_local", requestedDate)
        .maybeSingle();

      let taskStates: any[] = [];
      let totalScore = 0;
      let isLoggedByUser = false;

      if (!dailyLog) {
        // Missed day (auto state)
        taskStates =
          tasks?.map((task: any) => ({
            task_id: task.id,
            task_name: task.task_name,
            points: task.points,
            completed: false,
          })) || [];

        totalScore = 0;
        isLoggedByUser = false;
      } else {
        const { data: taskLogs } = await supabase
          .from("daily_task_logs")
          .select("*")
          .eq("daily_log_id", dailyLog.id);

        taskStates =
          tasks?.map((task: any) => {
            const existing = taskLogs?.find((t: any) => t.task_id === task.id);

            return {
              task_id: task.id,
              task_name: task.task_name,
              points: task.points,
              completed: existing ? existing.completed : false,
            };
          }) || [];

        totalScore = dailyLog.total_score;
        isLoggedByUser = dailyLog.is_logged_by_user;
      }

      res.json({
        challenge: {
          id: challenge.id,
          name: challenge.name,
        },
        date: requestedDate,
        dayNumber,
        total_score: totalScore,
        is_logged_by_user: isLoggedByUser,
        tasks: taskStates,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  },
);

//helper function to fill missing days
async function ensureDailyLogsExist(
  challenge: any,
  tasks: any[],
  challengeId: string,
) {
  if (challenge.status !== "active") return;

  const effectiveToday = getEffectiveDate(challenge.timezone_snapshot);

  const start = new Date(challenge.start_date);
  const today = new Date(effectiveToday);

  const diffTime = today.getTime() - start.getTime();
  const totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

  if (totalDays <= 0) return;

  const { data: existingLogs } = await supabase
    .from("daily_logs")
    .select("id, date_local")
    .eq("challenge_id", challengeId);

  const existingDates = new Set((existingLogs || []).map((l) => l.date_local));

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const formatted = d.toISOString().split("T")[0];

    if (!existingDates.has(formatted)) {
      const { data: newLog } = await supabase
        .from("daily_logs")
        .insert({
          challenge_id: challengeId,
          date_local: formatted,
          total_score: 0,
          is_logged_by_user: false, // 🔥 FIXED
          locked: false,
        })
        .select()
        .single();

      if (newLog) {
        const taskRows = tasks.map((task) => ({
          daily_log_id: newLog.id,
          task_id: task.id,
          completed: false, // 🔥 match DB column
          score_awarded: 0,
        }));

        await supabase.from("daily_task_logs").insert(taskRows);
      }
    }
  }
}

function calculateAdvancedStreaks(logs: any[], today: string) {
  let currentLogin = 0;
  let highestLogin = 0;
  let tempLogin = 0;

  let current75 = 0;
  let highest75 = 0;
  let temp75 = 0;

  let userMarkedDays = 0;
  let systemMarkedDays = 0;
  let totalCompletedDays = 0;

  for (const log of logs) {
    if (log.date_local > today) continue;

    // LOGIN STREAK
    if (log.is_logged_by_user) {
      tempLogin++;
      userMarkedDays++;
    } else {
      systemMarkedDays++;
      highestLogin = Math.max(highestLogin, tempLogin);
      tempLogin = 0;
    }

    // 75+ STREAK
    if (log.total_score >= 75) {
      temp75++;
      totalCompletedDays++;
    } else {
      highest75 = Math.max(highest75, temp75);
      temp75 = 0;
    }
  }

  highestLogin = Math.max(highestLogin, tempLogin);
  currentLogin = tempLogin;

  highest75 = Math.max(highest75, temp75);
  current75 = temp75;

  return {
    currentLoginStreak: currentLogin,
    highestLoginStreak: highestLogin,
    current75Streak: current75,
    highest75Streak: highest75,
    totalCompletedDays,
    userMarkedDays,
    systemMarkedDays,
  };
}

function buildGrid(logs: any[], today: string) {
  const grid = [];
  let currentDay = -1;

  for (let i = 0; i < 100; i++) {
    const log = logs[i];

    grid.push({
      date: log?.date_local || "",
      in_range: log?.date_local <= today ? true : false,
      is_today: log?.date_local == today ? true : false,
      is_future: !log ? true : false,
      day_number: i + 1,
      total_score: log?.total_score ?? -1,
      is_logged_by_user: log?.is_logged_by_user ?? false,
    });
  }

  return { cells: grid };
}

//to get insights
router.get("/:id/analytics", authenticate, async (req: any, res) => {
  const challengeId = req.params.id;
  const user = req.user;

  try {
    // 1️⃣ Get user
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", user.email)
      .single();

    if (userError) throw userError;

    // 2️⃣ Get challenge
    const { data: challenge, error: challengeError } = await supabase
      .from("challenges")
      .select("*")
      .eq("id", challengeId)
      .eq("user_id", userData.id)
      .single();

    if (challengeError || !challenge)
      return res.status(404).json({ message: "Challenge not found" });

    const effectiveToday = getEffectiveDate(challenge.timezone_snapshot);

    // 3️⃣ Fetch all logs
    const { data: logs } = await supabase
      .from("daily_logs")
      .select("date_local, is_logged_by_user, total_score")
      .eq("challenge_id", challengeId)
      .order("date_local", { ascending: true });

    const safeLogs = logs || [];

    // 4️⃣ Calculate streaks
    const streaks = calculateAdvancedStreaks(safeLogs, effectiveToday);

    // 5️⃣ Build grid
    const grid = buildGrid(safeLogs, effectiveToday);

    res.json({
      challenge: {
        id: challenge.id,
        name: challenge.name,
      },
      streaks,
      grid,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

//to get calendars
router.get("/:id/calendar", authenticate, async (req: any, res) => {
  const challengeId = req.params.id;
  const user = req.user;

  try {
    const { data: userData } = await supabase
      .from("users")
      .select("*")
      .eq("email", user.email)
      .single();

    const { data: challenge } = await supabase
      .from("challenges")
      .select("*")
      .eq("id", challengeId)
      .eq("user_id", userData.id)
      .single();

    if (!challenge)
      return res.status(404).json({ message: "Challenge not found" });

    const effectiveToday = getEffectiveDate(challenge.timezone_snapshot);

    const { data: logs } = await supabase
      .from("daily_logs")
      .select("date_local, total_score, is_logged_by_user")
      .eq("challenge_id", challengeId);

    const logsMap: Record<string, any> = {};
    (logs || []).forEach((l) => {
      logsMap[l.date_local] = l;
    });

    const start = new Date(challenge.start_date);
    const end = new Date(challenge.end_date);

    const months: any[] = [];

    const cursor = new Date(start);
    cursor.setDate(1);

    let dayNumber = 0;
    let currentDay;

    while (cursor <= end) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();

      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);

      const days = [];

      for (
        let d = new Date(firstDay);
        d <= lastDay;
        d.setDate(d.getDate() + 1)
      ) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");

        const dateStr = `${year}-${month}-${day}`;

        const inRange = d >= start && d <= end;
        inRange ? dayNumber++ : dayNumber;

        const isFuture = dateStr > effectiveToday;

        const log = logsMap[dateStr];

        days.push({
          date: dateStr,
          in_range: inRange,
          is_today: dateStr === effectiveToday,
          is_future: isFuture,
          day_number: dayNumber,
          total_score: log?.total_score || 0,
          is_logged_by_user: log?.is_logged_by_user || false,
        });
        if (dateStr === effectiveToday) {
          currentDay = dayNumber;
        }
      }

      months.push({
        label: `${firstDay.toLocaleString("default", {
          month: "long",
        })} ${year}`,
        year,
        month,
        days,
      });

      cursor.setMonth(cursor.getMonth() + 1);
    }

    let challengeName = challenge.name;

    res.json({ months, currentDay, challengeName });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
