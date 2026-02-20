const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json());
app.use(express.static(__dirname));

const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'tasks.json');
const activityFile = path.join(dataDir, 'activity.json');
const backupsDir = path.join(dataDir, 'backups');
const agentStatusFile = path.join(__dirname, 'agent-status.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
}

if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({ projects: [] }, null, 2), 'utf8');
}
if (!fs.existsSync(activityFile)) {
    fs.writeFileSync(activityFile, JSON.stringify({ activities: [] }, null, 2), 'utf8');
}

let lastBackupAt = 0;

function normalizeStatus(status) {
    if (!status) return 'offen';
    const s = String(status).toLowerCase();
    if (s === 'todo') return 'offen';
    if (s === 'in arbeit') return 'in-progress';
    return s;
}

function writeActivityData(data) {
    fs.writeFileSync(activityFile, JSON.stringify(data, null, 2), 'utf8');
}

function createSnapshotBackup(force = false) {
    const now = Date.now();
    if (!force && now - lastBackupAt < 60 * 1000) return; // max 1x/min

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tasksBackup = path.join(backupsDir, `tasks-${stamp}.json`);
    const activityBackup = path.join(backupsDir, `activity-${stamp}.json`);

    try {
        fs.copyFileSync(dataFile, tasksBackup);
        fs.copyFileSync(activityFile, activityBackup);
        lastBackupAt = now;

        // Keep only latest 50 backups per type
        const files = fs.readdirSync(backupsDir).sort().reverse();
        const taskFiles = files.filter(f => f.startsWith('tasks-'));
        const activityFiles = files.filter(f => f.startsWith('activity-'));

        for (const old of taskFiles.slice(50)) {
            fs.unlinkSync(path.join(backupsDir, old));
        }
        for (const old of activityFiles.slice(50)) {
            fs.unlinkSync(path.join(backupsDir, old));
        }
    } catch (err) {
        console.error('[BACKUP] Failed:', err.message);
    }
}

function readData() {
    try {
        const data = fs.readFileSync(dataFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { projects: [] };
    }
}

function writeData(data) {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
    createSnapshotBackup();
}

// GET all projects
app.get('/api/projects', (req, res) => {
    const data = readData();
    // Backward compatibility: normalize legacy statuses on read
    data.projects = (data.projects || []).map(project => ({
        ...project,
        tasks: (project.tasks || []).map(task => ({
            ...task,
            status: normalizeStatus(task.status)
        }))
    }));
    res.json(data);
});

// POST new project
app.post('/api/projects', (req, res) => {
    const { name, description, docs, projectPath } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Project name required' });
    }

    const data = readData();
    const codeRoot = '/Users/jeff/CODE';
    const projectFolderName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const defaultPath = path.join(codeRoot, projectFolderName);

    // Enforce local project root: all projects must live under /Users/jeff/CODE
    let resolvedProjectPath = projectPath ? path.resolve(projectPath) : defaultPath;
    if (!resolvedProjectPath.startsWith(path.resolve(codeRoot) + path.sep) && resolvedProjectPath !== path.resolve(codeRoot)) {
        console.warn(`[PROJECT] Rejected projectPath outside ${codeRoot}: ${resolvedProjectPath}. Using default path instead.`);
        resolvedProjectPath = defaultPath;
    }

    const newProject = {
        id: `proj-${uuidv4().slice(0, 8)}`,
        name,
        description: description || '',
        docs: docs || '# ' + name,
        projectPath: resolvedProjectPath,
        color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
        tasks: [],
        createdAt: new Date().toISOString()
    };

    data.projects.push(newProject);
    writeData(data);

    // Ensure directory exists
    try {
        if (!fs.existsSync(newProject.projectPath)) {
            fs.mkdirSync(newProject.projectPath, { recursive: true });
        }
    } catch (err) {
        console.error(`[PROJECT] Error creating directory ${newProject.projectPath}:`, err.message);
    }

    console.log(`[PROJECT] Created: "${name}" (${newProject.id}) at ${newProject.projectPath}`);
    res.status(201).json(newProject);
});

// PUT update project
app.put('/api/projects/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const data = readData();
    const projectIndex = data.projects.findIndex(p => p.id === id);

    if (projectIndex === -1) {
        return res.status(404).json({ error: 'Project not found' });
    }

    data.projects[projectIndex] = { ...data.projects[projectIndex], ...updates };
    writeData(data);

    res.json(data.projects[projectIndex]);
});

// DELETE project
app.delete('/api/projects/:id', (req, res) => {
    const { id } = req.params;
    const data = readData();
    const projectIndex = data.projects.findIndex(p => p.id === id);

    if (projectIndex === -1) {
        return res.status(404).json({ error: 'Project not found' });
    }

    const removedProject = data.projects.splice(projectIndex, 1)[0];
    writeData(data);

    console.log(`[PROJECT] Deleted: "${removedProject.name}"`);
    res.json({ success: true });
});

// POST new task to project
app.post('/api/projects/:projectId/tasks', (req, res) => {
    const { projectId } = req.params;
    const { title, description, status, priority, date, assignedAgent } = req.body;

    if (!title) {
        return res.status(400).json({ error: 'Title required' });
    }

    const data = readData();
    const project = data.projects.find(p => p.id === projectId);

    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }

    const newTask = {
        id: uuidv4().slice(0, 8),
        title,
        description: description || '',
        status: normalizeStatus(status || 'offen'),
        priority: priority || 'medium',
        assignedAgent: assignedAgent || 'CODEAGENT',
        date: date || new Date().toLocaleDateString('de-DE'),
        createdAt: new Date().toISOString(),
        reviewRejectCount: 0,
        hintl: false
    };

    project.tasks.push(newTask);
    writeData(data);

    // Activity log entry for dashboard/activity stream
    try {
        let activityData = { activities: [] };
        if (fs.existsSync(activityFile)) {
            activityData = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
        }
        activityData.activities.unshift({
            id: String(Date.now()),
            timestamp: new Date().toISOString(),
            action: 'task_created',
            title: 'Aufgabe erstellt',
            description: `"${title}" wurde zu ${project.name} hinzugefügt`,
            metadata: {
                projectId: project.id,
                projectName: project.name,
                taskId: newTask.id
            },
            status: 'completed'
        });
        writeActivityData(activityData);
    } catch (err) {
        console.error('[ACTIVITY] Failed to write task_created activity:', err.message);
    }

    console.log(`[TASK] Created: "${title}" in "${project.name}" (Agent: ${newTask.assignedAgent})`);
    res.status(201).json(newTask);
});

// PUT update task status
app.put('/api/projects/:projectId/tasks/:taskId', (req, res) => {
    const { projectId, taskId } = req.params;
    const updates = req.body;

    const data = readData();
    const project = data.projects.find(p => p.id === projectId);

    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }

    const taskIndex = project.tasks.findIndex(t => t.id === taskId);

    if (taskIndex === -1) {
        return res.status(404).json({ error: 'Task not found' });
    }

    const currentTask = project.tasks[taskIndex] || {};
    const oldStatus = normalizeStatus(currentTask.status);
    const normalizedUpdates = { ...updates };
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'status')) {
        normalizedUpdates.status = normalizeStatus(normalizedUpdates.status);
    }

    const nextTask = {
        ...currentTask,
        reviewRejectCount: currentTask.reviewRejectCount || 0,
        hintl: !!currentTask.hintl,
        ...normalizedUpdates
    };

    const isManualHintlReset = normalizedUpdates.status === 'offen' && (currentTask.hintl || currentTask.reviewRejectCount >= 3);

    // Infinite-loop guard:
    // If task is rejected from review back to offen 3x, move to HINTL and keep in review.
    // But if task is already HINTL and user sets it to offen manually, allow reset.
    const isReviewRejectedToOffen = oldStatus === 'review' && normalizedUpdates.status === 'offen' && !isManualHintlReset;
    if (isReviewRejectedToOffen) {
        nextTask.reviewRejectCount = (nextTask.reviewRejectCount || 0) + 1;
        if (nextTask.reviewRejectCount >= 3) {
            nextTask.hintl = true;
            nextTask.hintlAt = new Date().toISOString();
            nextTask.hintlReason = 'REVAGENT rejected task 3 times';
            nextTask.status = 'review';
            nextTask.assignedAgent = 'HINTL';
        }
    }

    // Manual reset path: only when status set back to offen
    if (isManualHintlReset) {
        nextTask.hintl = false;
        nextTask.hintlAt = null;
        nextTask.hintlReason = null;
        nextTask.reviewRejectCount = 0;
        nextTask.status = 'offen';
        if (!normalizedUpdates.assignedAgent || normalizedUpdates.assignedAgent === 'HINTL') {
            nextTask.assignedAgent = 'CODEAGENT';
        }
    }

    project.tasks[taskIndex] = nextTask;
    writeData(data);

    const finalStatus = normalizeStatus(nextTask.status);
    if (normalizedUpdates.status && finalStatus !== oldStatus) {
        console.log(`[TASK] "${project.tasks[taskIndex].title}": ${oldStatus} → ${finalStatus}`);

        // Activity log entry for status transitions
        try {
            let activityData = { activities: [] };
            if (fs.existsSync(activityFile)) {
                activityData = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
            }
            activityData.activities.unshift({
                id: String(Date.now()),
                timestamp: new Date().toISOString(),
                action: 'task_updated',
                title: 'Aufgabe verschoben',
                description: `"${project.tasks[taskIndex].title}" → ${finalStatus}`,
                metadata: {
                    projectId: project.id,
                    projectName: project.name,
                    taskId,
                    oldStatus,
                    newStatus: finalStatus
                },
                status: 'completed'
            });

            if (nextTask.hintl) {
                activityData.activities.unshift({
                    id: String(Date.now() + 1),
                    timestamp: new Date().toISOString(),
                    type: 'warning',
                    title: 'HINTL aktiviert',
                    message: `🛑 Orchestrator Guard: "${project.tasks[taskIndex].title}" nach 3 Review-Rejections auf HINTL gesetzt`,
                    description: 'Task bleibt in review und wird nicht mehr automatisch durch Orchestrator bearbeitet.',
                    project: project.id,
                    status: 'completed'
                });
            }

            writeActivityData(activityData);
        } catch (err) {
            console.error('[ACTIVITY] Failed to write task_updated activity:', err.message);
        }
    }

    res.json(project.tasks[taskIndex]);
});

// DELETE task
app.delete('/api/projects/:projectId/tasks/:taskId', (req, res) => {
    const { projectId, taskId } = req.params;

    const data = readData();
    const project = data.projects.find(p => p.id === projectId);

    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }

    const taskIndex = project.tasks.findIndex(t => t.id === taskId);

    if (taskIndex === -1) {
        return res.status(404).json({ error: 'Task not found' });
    }

    const removedTask = project.tasks.splice(taskIndex, 1)[0];
    writeData(data);

    console.log(`[TASK] Removed: "${removedTask.title}" from "${project.name}"`);
    res.json({ success: true });
});

// Status endpoint
app.get('/api/status', (req, res) => {
    const data = readData();
    const stats = {
        projects: data.projects.length,
        totalTasks: data.projects.reduce((sum, p) => sum + p.tasks.length, 0),
        tasksByStatus: {
            offen: 0,
            inProgress: 0,
            review: 0,
            done: 0
        }
    };

    data.projects.forEach(p => {
        p.tasks.forEach(t => {
            const s = normalizeStatus(t.status);
            if (s === 'offen') stats.tasksByStatus.offen++;
            if (s === 'in-progress') stats.tasksByStatus.inProgress++;
            if (s === 'review') stats.tasksByStatus.review++;
            if (s === 'done') stats.tasksByStatus.done++;
        });
    });

    res.json(stats);
});

// Molt Status - Queue
app.get('/api/molt-status', (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const todoFile = path.join(__dirname, '..', 'MOLT_TODO.md');
        
        // Parse TODO file to extract tasks
        let queue = [];
        try {
            const content = fs.readFileSync(todoFile, 'utf8');
            const lines = content.split('\n');
            let section = null;
            
            lines.forEach(line => {
                if (line.includes('Completed')) section = 'completed';
                else if (line.includes('Next Up')) section = 'pending';
                else if (line.startsWith('- [x]')) {
                    queue.push({
                        title: line.replace('- [x] ', '').split('(')[0].trim(),
                        description: line.includes('(') ? line.split('(')[1].replace(')', '') : '',
                        status: 'completed',
                        completed: true
                    });
                } else if (line.startsWith('- [ ]')) {
                    queue.push({
                        title: line.replace('- [ ] ', '').split('(')[0].trim(),
                        description: line.includes('(') ? line.split('(')[1].replace(')', '') : '',
                        status: 'pending',
                        completed: false
                    });
                }
            });
        } catch (err) {
            queue = [];
        }

        res.json({ queue });
    } catch (error) {
        res.json({ queue: [] });
    }
});

// Activity Log
app.get('/api/activity', (req, res) => {
    try {
        const content = fs.readFileSync(activityFile, 'utf8');
        const data = JSON.parse(content);
        const limit = parseInt(req.query.limit || '200', 10);
        const activities = Array.isArray(data.activities) ? data.activities : [];

        // Always return newest first for dashboard/activity views
        const sorted = activities
            .slice()
            .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
            .slice(0, limit);

        res.json({ activities: sorted });
    } catch (error) {
        res.json({ activities: [] });
    }
});

// Get Orchestrator Cron Job Stats
app.get('/api/orchestrator-cron', (req, res) => {
    try {
        let nextRunAtMs = null;
        let lastRunAtMs = null;
        let jobName = 'Orchestrator Delegation Scan (10m)';
        
        try {
            const { execSync } = require('child_process');
            const output = execSync(`curl -s 'http://localhost:7777/api/gateway/cron/list' 2>/dev/null || true`, { 
                encoding: 'utf8',
                timeout: 2000,
                maxBuffer: 1024 * 1024
            }).trim();
            
            if (output && output.startsWith('{')) {
                const parsed = JSON.parse(output);
                if (parsed.jobs && Array.isArray(parsed.jobs)) {
                    const orchJob = parsed.jobs.find(j => 
                        j.agentId === 'orchestrator' && 
                        (j.name?.includes('delegation') || j.name?.includes('scan'))
                    );
                    if (orchJob?.state) {
                        nextRunAtMs = orchJob.state.nextRunAtMs;
                        lastRunAtMs = orchJob.state.lastRunAtMs;
                        jobName = orchJob.name || jobName;
                    }
                }
            }
        } catch (e) {
            // Gateway unavailable or timeout, fallback
        }
        
        // Fallback: Calculate from last activity event
        if (!nextRunAtMs || nextRunAtMs < Date.now()) {
            try {
                const activityContent = fs.readFileSync(activityFile, 'utf8');
                const activityData = JSON.parse(activityContent);
                const activities = (activityData.activities || []);
                
                const lastEvent = activities.find(a => 
                    (a.message || '').includes('🫀 Orchestrator:')
                );
                
                if (lastEvent && lastEvent.timestamp) {
                    const lastTs = new Date(lastEvent.timestamp).getTime();
                    lastRunAtMs = lastTs;
                    // Calculate next run: last + 10min, or if that's in past, align to next 10-min boundary
                    let nextTs = lastTs + (10 * 60 * 1000);
                    const now = Date.now();
                    if (nextTs < now) {
                        // Jump to next 10-min boundary from now
                        const intervalMs = 10 * 60 * 1000;
                        nextTs = Math.ceil(now / intervalMs) * intervalMs;
                    }
                    nextRunAtMs = nextTs;
                } else {
                    // No last event found, estimate next run at next 10-min boundary
                    const intervalMs = 10 * 60 * 1000;
                    nextRunAtMs = Math.ceil(Date.now() / intervalMs) * intervalMs;
                }
            } catch (e) {
                // Fallback failed, use next 10-min boundary
                const intervalMs = 10 * 60 * 1000;
                nextRunAtMs = Math.ceil(Date.now() / intervalMs) * intervalMs;
            }
        }
        
        res.json({
            nextRunAtMs,
            lastRunAtMs,
            intervalMs: 600000,
            status: nextRunAtMs ? 'active' : 'unknown',
            jobName
        });
    } catch (error) {
        res.json({
            nextRunAtMs: null,
            lastRunAtMs: null,
            intervalMs: 600000,
            status: 'error',
            jobName: 'Orchestrator Delegation Scan (10m)',
            error: error.message
        });
    }
});

// Get agent status
app.get('/api/agent-status', (req, res) => {
    try {
        if (fs.existsSync(agentStatusFile)) {
            const data = JSON.parse(fs.readFileSync(agentStatusFile, 'utf8'));
            res.json(data);
        } else {
            res.json({ status: 'available', text: 'Verfügbar', updatedAt: new Date().toISOString() });
        }
    } catch (error) {
        res.json({ status: 'available', text: 'Verfügbar', updatedAt: new Date().toISOString() });
    }
});

// GET active subagents
app.get('/api/subagents', (req, res) => {
    try {
        const agentsDir = '/Users/jeff/.openclaw/agents';
        const subagents = [];

        if (fs.existsSync(agentsDir)) {
            const agents = fs.readdirSync(agentsDir).filter(a => a !== 'main' && !a.startsWith('.'));

            for (const agentId of agents) {
                const sessionFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
                let status = 'idle';
                let lastUpdate = null;
                let id = `agent:${agentId}:main`;

                if (fs.existsSync(sessionFile)) {
                    const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                    const sessions = Array.isArray(data.sessions)
                        ? data.sessions
                        : Object.entries(data).map(([key, val]) => ({ key, ...val }));

                    const recent = sessions
                        .filter(s => s && s.updatedAt)
                        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];

                    if (recent) {
                        id = recent.key || id;
                        lastUpdate = new Date(recent.updatedAt).toISOString();
                        const age = Date.now() - recent.updatedAt;

                        if (recent.abortedLastRun) status = 'error';
                        else if (age < 5 * 60 * 1000) status = 'working';
                        else status = 'idle';
                    }
                }

                subagents.push({
                    id,
                    name: agentId.toUpperCase(),
                    status,
                    lastUpdate
                });
            }
        }

        res.json({ subagents });
    } catch (error) {
        console.error('Subagent fetch error:', error);
        res.json({ subagents: [] });
    }
});

// GET live agent feed — reads recent assistant messages from active agent sessions
app.get('/api/agent-feed', (req, res) => {
    try {
        const agentsDir = '/Users/jeff/.openclaw/agents';
        const feedItems = [];
        const limit = parseInt(req.query.limit) || 20;

        if (fs.existsSync(agentsDir)) {
            const agents = fs.readdirSync(agentsDir).filter(a => a !== 'main' && !a.startsWith('.'));

            for (const agentId of agents) {
                const sessionsFile = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
                if (!fs.existsSync(sessionsFile)) continue;

                let sessionsData;
                try {
                    sessionsData = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
                } catch { continue; }

                // Get entries from sessions data (it's a dict keyed by session key)
                const sessions = Object.entries(sessionsData)
                    .filter(([k, v]) => v && typeof v === 'object' && v.sessionId)
                    .map(([key, val]) => ({ key, ...val }))
                    .filter(s => s.updatedAt)
                    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

                // Only look at the most recent session per agent
                const recent = sessions[0];
                if (!recent) continue;

                const age = Date.now() - recent.updatedAt;
                // Only show feed from sessions active in last 30 minutes
                if (age > 30 * 60 * 1000) continue;

                const logFile = path.join(agentsDir, agentId, 'sessions', `${recent.sessionId}.jsonl`);
                if (!fs.existsSync(logFile)) continue;

                // Read last ~8KB from the log file to get recent messages
                const stat = fs.statSync(logFile);
                const readSize = Math.min(stat.size, 16384);
                const buffer = Buffer.alloc(readSize);
                const fd = fs.openSync(logFile, 'r');
                fs.readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
                fs.closeSync(fd);

                const lines = buffer.toString('utf8').split('\n').filter(l => l.trim());

                for (const line of lines) {
                    try {
                        const entry = JSON.parse(line);
                        if (entry.type !== 'message' || !entry.message) continue;
                        const msg = entry.message;

                        if (msg.role === 'assistant' && msg.content) {
                            // Extract text content
                            const textParts = Array.isArray(msg.content)
                                ? msg.content.filter(c => c.type === 'text').map(c => c.text)
                                : [String(msg.content)];

                            // Extract tool calls
                            const toolCalls = Array.isArray(msg.content)
                                ? msg.content.filter(c => c.type === 'toolCall').map(c => ({
                                    tool: c.name,
                                    args: typeof c.arguments === 'string' ? c.arguments.substring(0, 200) : JSON.stringify(c.arguments || {}).substring(0, 200)
                                }))
                                : [];

                            const text = textParts.join('\n').substring(0, 500);
                            if (!text && toolCalls.length === 0) continue;

                            feedItems.push({
                                agent: agentId.toUpperCase(),
                                timestamp: entry.timestamp || msg.timestamp ? new Date(entry.timestamp || msg.timestamp).toISOString() : null,
                                text: text || null,
                                toolCalls: toolCalls.length > 0 ? toolCalls : null,
                                model: msg.model || null,
                                label: recent.label || null
                            });
                        } else if (msg.role === 'toolResult') {
                            // Show tool results briefly
                            const resultText = Array.isArray(msg.content)
                                ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n').substring(0, 300)
                                : String(msg.content || '').substring(0, 300);

                            if (resultText && msg.toolName) {
                                feedItems.push({
                                    agent: agentId.toUpperCase(),
                                    timestamp: entry.timestamp ? new Date(entry.timestamp).toISOString() : null,
                                    text: null,
                                    toolResult: {
                                        tool: msg.toolName,
                                        output: resultText,
                                        status: msg.details?.status || null,
                                        isError: msg.isError || false
                                    },
                                    label: recent.label || null
                                });
                            }
                        }
                    } catch { /* skip malformed lines */ }
                }
            }
        }

        // Sort by timestamp desc and limit
        feedItems.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
        res.json({ feed: feedItems.slice(0, limit) });
    } catch (error) {
        console.error('Agent feed error:', error);
        res.json({ feed: [] });
    }
});

// Update agent status
app.post('/api/agent-status', (req, res) => {
    try {
        const data = {
            status: req.body.status || 'available',
            task: req.body.task || null,
            updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(agentStatusFile, JSON.stringify(data, null, 2));
        res.json({ success: true, ...data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add new activity entry
app.post('/api/activity', (req, res) => {
    try {
        let data = { activities: [] };

        if (fs.existsSync(activityFile)) {
            data = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
        }

        const title = req.body.title || null;
        const message = req.body.message || null;
        const description = req.body.description || null;

        if (!title && !message && !description) {
            return res.status(400).json({ error: 'title, message oder description erforderlich' });
        }

        const newActivity = {
            id: String(Date.now()),
            timestamp: new Date().toISOString(),
            type: req.body.type || 'update',
            title,
            message,
            description,
            status: req.body.status || 'completed',
            project: req.body.project || null
        };

        // newest first
        data.activities.unshift(newActivity);
        writeActivityData(data);
        createSnapshotBackup();

        res.json({ success: true, activity: newActivity });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get feature file content
app.get('/api/projects/:projectId/features/:featureId', (req, res) => {
    const { projectId, featureId } = req.params;
    const data = readData();
    const project = data.projects.find(p => p.id === projectId);

    if (!project) {
        return res.status(404).json({ error: 'Projekt nicht gefunden' });
    }

    if (!project.projectPath) {
        return res.status(400).json({ error: 'Kein Projektpfad konfiguriert' });
    }

    try {
        const featuresPath = path.join(project.projectPath, 'features');
        const files = fs.readdirSync(featuresPath);
        const featureFile = files.find(f => f.startsWith(featureId) && f.endsWith('.md'));

        if (!featureFile) {
            return res.status(404).json({ error: 'Feature-Datei nicht gefunden' });
        }

        const filePath = path.join(featuresPath, featureFile);
        const content = fs.readFileSync(filePath, 'utf8');

        res.json({ 
            id: featureId,
            filename: featureFile,
            content: content,
            path: filePath
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update feature file content
app.put('/api/projects/:projectId/features/:featureId', (req, res) => {
    const { projectId, featureId } = req.params;
    const { content } = req.body;
    const data = readData();
    const project = data.projects.find(p => p.id === projectId);

    if (!project) {
        return res.status(404).json({ error: 'Projekt nicht gefunden' });
    }

    if (!project.projectPath) {
        return res.status(400).json({ error: 'Kein Projektpfad konfiguriert' });
    }

    try {
        const featuresPath = path.join(project.projectPath, 'features');
        const files = fs.readdirSync(featuresPath);
        const featureFile = files.find(f => f.startsWith(featureId) && f.endsWith('.md'));

        if (!featureFile) {
            return res.status(404).json({ error: 'Feature-Datei nicht gefunden' });
        }

        const filePath = path.join(featuresPath, featureFile);
        fs.writeFileSync(filePath, content, 'utf8');

        // Update task title from first line
        const firstLine = content.split('\n')[0].replace(/^#+\s*/, '');
        const task = project.tasks.find(t => t.id === featureId);
        if (task && firstLine) {
            task.title = firstLine;
            writeData(data);
        }

        res.json({ 
            success: true,
            id: featureId,
            filename: featureFile,
            message: 'Feature aktualisiert'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Sync Features from Project
app.post('/api/projects/:projectId/sync-features', (req, res) => {
    const { projectId } = req.params;
    const data = readData();
    const project = data.projects.find(p => p.id === projectId);

    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }

    try {
        // Use stored projectPath or from request
        const projectPath = project.projectPath || req.body.projectPath;
        if (!projectPath) {
            return res.status(400).json({ error: 'projectPath required' });
        }

        const featuresPath = path.join(projectPath, 'features');
        
        if (!fs.existsSync(featuresPath)) {
            return res.json({ synced: 0, tasks: [] });
        }

        const files = fs.readdirSync(featuresPath);
        const featureFiles = files.filter(f => f.startsWith('PROJ-') && f.endsWith('.md'));

        let syncedCount = 0;
        const newTasks = [];

        featureFiles.forEach(file => {
            const filePath = path.join(featuresPath, file);
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Extract feature name from file
            const match = file.match(/PROJ-(\d+)-(.+)\.md/);
            if (!match) return;

            const featureNum = match[1];
            const featureName = match[2].replace(/-/g, ' ');
            const firstLine = content.split('\n')[0].replace(/^#+\s*/, '');
            const title = firstLine || featureName;

            // Check if task already exists
            const existingTask = project.tasks.find(t => t.id === `PROJ-${featureNum}`);
            
            if (!existingTask) {
                const newTask = {
                    id: `PROJ-${featureNum}`,
                    title: title,
                    description: `Feature specification - Ready for Architecture`,
                    status: 'review',
                    priority: 'high',
                    date: new Date().toLocaleDateString('de-DE'),
                    featureFile: file,
                    createdAt: new Date().toISOString()
                };
                
                project.tasks.push(newTask);
                newTasks.push(newTask);
                syncedCount++;
            }
        });

        writeData(data);
        console.log(`[SYNC] ${syncedCount} features synced for project "${project.name}"`);
        
        res.json({ 
            synced: syncedCount, 
            tasks: newTasks,
            message: `${syncedCount} feature(s) synced successfully`
        });
    } catch (error) {
        console.error('Error syncing features:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// Context Files API (Agent Configuration)
// ==========================================

const WORKSPACE_PATH = process.env.OPENCLAW_WORKSPACE || '/Users/jeff/.openclaw/workspace';
const AGENTS_BASE_PATH = '/Users/jeff/.openclaw/agents';

function resolveWorkspacePath(agentParam) {
    if (!agentParam || agentParam === 'main') return WORKSPACE_PATH;

    // Supports values like: "orchestrator" or "agent:orchestrator:main"
    const parts = String(agentParam).split(':');
    const agentId = parts.length >= 2 ? parts[1] : agentParam;

    const candidate = path.join(AGENTS_BASE_PATH, agentId, 'workspace');
    if (fs.existsSync(candidate)) return candidate;

    // Fallback to main workspace if unknown
    return WORKSPACE_PATH;
}

const CONTEXT_FILES = [
    { name: 'MEMORY.md', description: 'Langzeit-Gedächtnis & Notizen' },
    { name: 'AGENTS.md', description: 'Agent-Verhaltensregeln' },
    { name: 'SOUL.md', description: 'Persönlichkeit & Werte' },
    { name: 'USER.md', description: 'Infos über den User' },
    { name: 'TOOLS.md', description: 'Tool-Konfiguration & Notizen' },
    { name: 'IDENTITY.md', description: 'Name, Vibe, Avatar' },
    { name: 'HEARTBEAT.md', description: 'Periodische Aufgaben' }
];

// GET all context files
app.get('/api/context-files', (req, res) => {
    const workspacePath = resolveWorkspacePath(req.query.agent);
    const files = CONTEXT_FILES.map(file => {
        const filePath = path.join(workspacePath, file.name);
        let exists = false;
        let size = 0;
        let modifiedAt = null;
        
        try {
            const stats = fs.statSync(filePath);
            exists = true;
            size = stats.size;
            modifiedAt = stats.mtime.toISOString();
        } catch (err) {
            // File doesn't exist
        }
        
        return {
            ...file,
            exists,
            size,
            modifiedAt
        };
    });
    
    res.json({ files });
});

// GET single context file content
app.get('/api/context-files/:filename', (req, res) => {
    const { filename } = req.params;

    // Security: Only allow predefined files
    const allowed = CONTEXT_FILES.find(f => f.name === filename);
    if (!allowed) {
        return res.status(403).json({ error: 'Datei nicht erlaubt' });
    }

    const workspacePath = resolveWorkspacePath(req.query.agent);
    const filePath = path.join(workspacePath, filename);
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const stats = fs.statSync(filePath);
        
        res.json({
            name: filename,
            description: allowed.description,
            content,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString()
        });
    } catch (err) {
        if (err.code === 'ENOENT') {
            res.json({
                name: filename,
                description: allowed.description,
                content: '',
                exists: false
            });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// PUT update context file
app.put('/api/context-files/:filename', (req, res) => {
    const { filename } = req.params;
    const { content } = req.body;

    // Security: Only allow predefined files
    const allowed = CONTEXT_FILES.find(f => f.name === filename);
    if (!allowed) {
        return res.status(403).json({ error: 'Datei nicht erlaubt' });
    }

    if (typeof content !== 'string') {
        return res.status(400).json({ error: 'Content required' });
    }

    const workspacePath = resolveWorkspacePath(req.query.agent);
    const filePath = path.join(workspacePath, filename);
    
    try {
        fs.writeFileSync(filePath, content, 'utf8');
        const stats = fs.statSync(filePath);
        
        console.log(`[CONTEXT] Updated: ${filename}`);
        
        res.json({
            success: true,
            name: filename,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// File Browser API
// ==========================================

const IGNORED_DIRS = ['node_modules', '.git', '.next', 'dist', '.turbo', '__pycache__', '.cache', 'coverage'];
const IGNORED_FILES = ['.DS_Store', 'Thumbs.db'];

// Get file icon based on extension
function getFileIcon(filename) {
    const ext = path.extname(filename).toLowerCase();
    const icons = {
        '.ts': '🟦',
        '.tsx': '⚛️',
        '.js': '🟨',
        '.jsx': '⚛️',
        '.json': '📋',
        '.md': '📝',
        '.css': '🎨',
        '.scss': '🎨',
        '.html': '🌐',
        '.py': '🐍',
        '.yml': '⚙️',
        '.yaml': '⚙️',
        '.env': '🔒',
        '.gitignore': '📦',
        '.sh': '💻',
        '.sql': '🗃️',
        '.svg': '🖼️',
        '.png': '🖼️',
        '.jpg': '🖼️',
        '.jpeg': '🖼️'
    };
    return icons[ext] || '📄';
}

// Build directory tree recursively
function buildFileTree(dirPath, relativePath = '') {
    const items = [];
    
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            // Skip ignored directories and files
            if (IGNORED_DIRS.includes(entry.name) || IGNORED_FILES.includes(entry.name)) {
                continue;
            }
            
            const fullPath = path.join(dirPath, entry.name);
            const relPath = path.join(relativePath, entry.name);
            
            if (entry.isDirectory()) {
                const children = buildFileTree(fullPath, relPath);
                items.push({
                    name: entry.name,
                    path: relPath,
                    type: 'directory',
                    icon: '📁',
                    children: children
                });
            } else {
                const stats = fs.statSync(fullPath);
                items.push({
                    name: entry.name,
                    path: relPath,
                    type: 'file',
                    icon: getFileIcon(entry.name),
                    size: stats.size,
                    modifiedAt: stats.mtime.toISOString()
                });
            }
        }
        
        // Sort: directories first, then files, alphabetically
        items.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
    } catch (error) {
        console.error('Error reading directory:', error.message);
    }
    
    return items;
}

// GET file tree for project
app.get('/api/projects/:id/files', (req, res) => {
    const { id } = req.params;
    const data = readData();
    const project = data.projects.find(p => p.id === id);

    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.projectPath) {
        return res.status(400).json({ error: 'No project path configured', needsPath: true });
    }

    if (!fs.existsSync(project.projectPath)) {
        return res.status(404).json({ error: 'Project path does not exist', path: project.projectPath });
    }

    try {
        const tree = buildFileTree(project.projectPath);
        res.json({
            projectPath: project.projectPath,
            tree: tree
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET file content
app.get('/api/projects/:id/files/*', (req, res) => {
    const { id } = req.params;
    const filePath = req.params[0]; // Everything after /files/
    
    const data = readData();
    const project = data.projects.find(p => p.id === id);

    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.projectPath) {
        return res.status(400).json({ error: 'No project path configured' });
    }

    const fullPath = path.join(project.projectPath, filePath);
    
    // Security: Ensure the path is within the project directory
    const normalizedProject = path.resolve(project.projectPath);
    const normalizedFile = path.resolve(fullPath);
    
    if (!normalizedFile.startsWith(normalizedProject)) {
        return res.status(403).json({ error: 'Access denied: Path traversal detected' });
    }

    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    try {
        const stats = fs.statSync(fullPath);
        
        if (stats.isDirectory()) {
            return res.status(400).json({ error: 'Path is a directory' });
        }
        
        // Check file size (limit to 1MB for text files)
        if (stats.size > 1024 * 1024) {
            return res.status(413).json({ error: 'File too large (max 1MB)' });
        }
        
        const content = fs.readFileSync(fullPath, 'utf8');
        const ext = path.extname(filePath).toLowerCase();
        
        res.json({
            path: filePath,
            name: path.basename(filePath),
            content: content,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
            extension: ext,
            icon: getFileIcon(path.basename(filePath))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT save file content
app.put('/api/projects/:id/files/*', (req, res) => {
    const { id } = req.params;
    const filePath = req.params[0];
    const { content } = req.body;
    
    const data = readData();
    const project = data.projects.find(p => p.id === id);

    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.projectPath) {
        return res.status(400).json({ error: 'No project path configured' });
    }

    if (typeof content !== 'string') {
        return res.status(400).json({ error: 'Content required' });
    }

    const fullPath = path.join(project.projectPath, filePath);
    
    // Security: Ensure the path is within the project directory
    const normalizedProject = path.resolve(project.projectPath);
    const normalizedFile = path.resolve(fullPath);
    
    if (!normalizedFile.startsWith(normalizedProject)) {
        return res.status(403).json({ error: 'Access denied: Path traversal detected' });
    }

    try {
        // Create directory if it doesn't exist
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(fullPath, content, 'utf8');
        const stats = fs.statSync(fullPath);
        
        console.log(`[FILE] Saved: ${filePath} in project "${project.name}"`);
        
        res.json({
            success: true,
            path: filePath,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// Orchestrator Delegation Logic (NEW)
// ==========================================

// Helper: Check if agent is busy (has active sub-agent sessions)
function isAgentBusy(agentId) {
    try {
        const sessionDir = path.join(AGENTS_BASE_PATH, agentId, 'sessions');
        if (!fs.existsSync(sessionDir)) return false;

        const sessionFiles = fs.readdirSync(sessionDir).filter(f => f.endsWith('.jsonl'));
        
        // Check for recent activity (within last 5 min)
        const now = Date.now();
        const recentSessions = sessionFiles.filter(f => {
            const filePath = path.join(sessionDir, f);
            try {
                const stats = fs.statSync(filePath);
                return (now - stats.mtimeMs) < 5 * 60 * 1000;
            } catch {
                return false;
            }
        });

        return recentSessions.length > 0;
    } catch (err) {
        console.error(`[AGENT] Error checking busy status for ${agentId}:`, err.message);
        return false;
    }
}

// GET: Next task to delegate (sorted by priority + date)
app.get('/api/orchestrator/next-task', (req, res) => {
    try {
        const data = readData();
        let offenTask = null;
        let reviewTask = null;
        let offenProject = null;
        let reviewProject = null;

        // Collect oldest offen task across all projects
        for (const p of data.projects) {
            const offenTasks = p.tasks.filter(t => 
                normalizeStatus(t.status) === 'offen' && 
                !t.hintl
            );

            const sorted = offenTasks.sort((a, b) => {
                const prioOrder = { 'high': 0, 'medium': 1, 'low': 2 };
                const prioA = prioOrder[a.priority] ?? 1;
                const prioB = prioOrder[b.priority] ?? 1;
                if (prioA !== prioB) return prioA - prioB;
                return new Date(a.date || '2099-01-01') - new Date(b.date || '2099-01-01');
            });

            if (sorted.length > 0 && !offenTask) {
                offenTask = sorted[0];
                offenProject = p;
            }
        }

        // Collect oldest review task across all projects (INDEPENDENTLY)
        for (const p of data.projects) {
            const reviewTasks = p.tasks.filter(t => 
                normalizeStatus(t.status) === 'review' && 
                !t.hintl
            );

            const sorted = reviewTasks.sort((a, b) => {
                const prioOrder = { 'high': 0, 'medium': 1, 'low': 2 };
                const prioA = prioOrder[a.priority] ?? 1;
                const prioB = prioOrder[b.priority] ?? 1;
                if (prioA !== prioB) return prioA - prioB;
                return new Date(a.date || '2099-01-01') - new Date(b.date || '2099-01-01');
            });

            if (sorted.length > 0 && !reviewTask) {
                reviewTask = sorted[0];
                reviewProject = p;
            }
        }

        // Return based on query param: ?type=offen or ?type=review
        // If type specified, return that type; otherwise return offen first (for backwards compatibility)
        const requestType = req.query.type || 'offen';

        if (requestType === 'review') {
            if (!reviewTask || !reviewProject) {
                return res.json({ 
                    task: null, 
                    project: null,
                    message: 'Keine review Tasks gefunden',
                    targetAgent: 'REVAGENT'
                });
            }
            return res.json({
                task: reviewTask,
                project: {
                    id: reviewProject.id,
                    name: reviewProject.name,
                    projectPath: reviewProject.projectPath
                },
                targetAgent: 'REVAGENT'
            });
        }

        // Default: offen
        if (!offenTask || !offenProject) {
            return res.json({ 
                task: null, 
                project: null,
                message: 'Keine offen Tasks gefunden',
                targetAgent: 'CODEAGENT'
            });
        }

        res.json({
            task: offenTask,
            project: {
                id: offenProject.id,
                name: offenProject.name,
                projectPath: offenProject.projectPath
            },
            targetAgent: 'CODEAGENT'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST: Delegate single task to agent (offen → in-progress)
app.post('/api/orchestrator/delegate', (req, res) => {
    try {
        const { projectId, taskId, agentId } = req.body;

        if (!projectId || !taskId || !agentId) {
            return res.status(400).json({ 
                error: 'projectId, taskId, agentId erforderlich' 
            });
        }

        // Validate agent
        if (!['codeagent', 'revagent'].includes(agentId.toLowerCase())) {
            return res.status(400).json({ 
                error: 'Invalid agentId (must be codeagent or revagent)' 
            });
        }

        const data = readData();
        const project = data.projects.find(p => p.id === projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const taskIndex = project.tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const task = project.tasks[taskIndex];

        // Check agent busy
        const busy = isAgentBusy(agentId);
        if (busy) {
            // Log warning
            try {
                let activityData = { activities: [] };
                if (fs.existsSync(activityFile)) {
                    activityData = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
                }
                activityData.activities.unshift({
                    id: String(Date.now()),
                    timestamp: new Date().toISOString(),
                    type: 'warning',
                    message: `⏸️ Orchestrator: Delegation skipped - ${agentId.toUpperCase()} busy; retry next heartbeat`,
                    project: projectId,
                    status: 'completed'
                });
                writeActivityData(activityData);
            } catch (err) {
                console.error('[ACTIVITY] Failed to log busy status:', err.message);
            }

            return res.json({
                success: false,
                reason: 'agent_busy',
                message: `${agentId.toUpperCase()} ist noch mit einer anderen Task beschäftigt`
            });
        }

        // Set task to in-progress
        const agentMap = { 'codeagent': 'CODEAGENT', 'revagent': 'REVAGENT' };
        task.status = 'in-progress';
        task.assignedAgent = agentMap[agentId.toLowerCase()];
        task.delegatedAt = new Date().toISOString();
        task.delegatedToAgent = agentId.toLowerCase();

        writeData(data);

        // Log delegation
        try {
            let activityData = { activities: [] };
            if (fs.existsSync(activityFile)) {
                activityData = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
            }
            activityData.activities.unshift({
                id: String(Date.now()),
                timestamp: new Date().toISOString(),
                type: 'delegation',
                message: `🎯 Orchestrator: Delegating "${task.title}" to ${agentMap[agentId.toLowerCase()]}`,
                description: `Project: ${project.name} (${projectId}) | Task: ${taskId} | Agent: ${agentId}`,
                project: projectId,
                projectName: project.name,
                taskId: taskId,
                agentId: agentId,
                status: 'delegated'
            });
            writeActivityData(activityData);
        } catch (err) {
            console.error('[ACTIVITY] Failed to log delegation:', err.message);
        }

        console.log(`[ORCHESTRATOR] Delegated "${task.title}" (${taskId}) to ${agentId} (Project: ${project.name})`);

        res.json({
            success: true,
            task: task,
            project: { id: project.id, name: project.name },
            message: `Task delegiert an ${agentMap[agentId.toLowerCase()]}`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST: Mark task as completed by agent (in-progress → review or done)
app.post('/api/orchestrator/task-completed', (req, res) => {
    try {
        const { projectId, taskId, agentId, targetStatus } = req.body;

        if (!projectId || !taskId || !agentId) {
            return res.status(400).json({ 
                error: 'projectId, taskId, agentId erforderlich' 
            });
        }

        const data = readData();
        const project = data.projects.find(p => p.id === projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const taskIndex = project.tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const task = project.tasks[taskIndex];

        // CodeAgent completion → review
        // RevAgent completion → done
        let nextStatus = 'review';
        if (agentId.toLowerCase() === 'revagent') {
            nextStatus = 'done';
        }
        if (targetStatus && ['review', 'done'].includes(targetStatus)) {
            nextStatus = targetStatus;
        }

        const oldStatus = task.status;
        task.status = nextStatus;
        task.completedAt = new Date().toISOString();
        task.completedByAgent = agentId.toLowerCase();

        writeData(data);

        // Log completion
        try {
            let activityData = { activities: [] };
            if (fs.existsSync(activityFile)) {
                activityData = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
            }
            activityData.activities.unshift({
                id: String(Date.now()),
                timestamp: new Date().toISOString(),
                type: 'system',
                message: `✅ ${agentId.toUpperCase()}: Completed "${task.title}" → ${nextStatus}`,
                description: `Project: ${project.name} (${projectId}) | Task: ${taskId}`,
                project: projectId,
                projectName: project.name,
                taskId: taskId,
                agentId: agentId,
                status: 'completed'
            });
            writeActivityData(activityData);
        } catch (err) {
            console.error('[ACTIVITY] Failed to log completion:', err.message);
        }

        console.log(`[ORCHESTRATOR] Task "${task.title}" (${taskId}) completed by ${agentId} → ${nextStatus}`);

        res.json({
            success: true,
            task: task,
            message: `Task abgeschlossen → ${nextStatus}`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST: Reject task from review (review → offen, increment counter)
app.post('/api/orchestrator/task-rejected', (req, res) => {
    try {
        const { projectId, taskId } = req.body;

        if (!projectId || !taskId) {
            return res.status(400).json({ 
                error: 'projectId, taskId erforderlich' 
            });
        }

        const data = readData();
        const project = data.projects.find(p => p.id === projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const taskIndex = project.tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const task = project.tasks[taskIndex];

        // Increment reject counter
        task.reviewRejectCount = (task.reviewRejectCount || 0) + 1;

        if (task.reviewRejectCount >= 3) {
            // Mark as HINTL
            task.hintl = true;
            task.hintlAt = new Date().toISOString();
            task.hintlReason = 'REVAGENT rejected task 3 times';
            task.assignedAgent = 'HINTL';
            task.status = 'review'; // Stays in review

            writeData(data);

            // Log HINTL
            try {
                let activityData = { activities: [] };
                if (fs.existsSync(activityFile)) {
                    activityData = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
                }
                activityData.activities.unshift({
                    id: String(Date.now()),
                    timestamp: new Date().toISOString(),
                    type: 'warning',
                    message: `🛑 Orchestrator Guard: "${task.title}" nach 3 Review-Rejections auf HINTL gesetzt`,
                    description: `Task bleibt in review und wird nicht mehr automatisch delegiert. Manual intervention required.`,
                    project: projectId,
                    projectName: project.name,
                    taskId: taskId,
                    status: 'completed'
                });
                writeActivityData(activityData);
            } catch (err) {
                console.error('[ACTIVITY] Failed to log HINTL:', err.message);
            }

            console.log(`[ORCHESTRATOR] Task "${task.title}" (${taskId}) marked as HINTL (3x rejected)`);

            return res.json({
                success: true,
                task: task,
                status: 'hintl',
                message: 'Task nach 3 Rejections auf HINTL gesetzt'
            });
        }

        // Reset to offen
        task.status = 'offen';
        task.assignedAgent = 'CODEAGENT';

        writeData(data);

        // Log rejection
        try {
            let activityData = { activities: [] };
            if (fs.existsSync(activityFile)) {
                activityData = JSON.parse(fs.readFileSync(activityFile, 'utf8'));
            }
            activityData.activities.unshift({
                id: String(Date.now()),
                timestamp: new Date().toISOString(),
                type: 'warning',
                message: `↩️ REVAGENT: "${task.title}" rejected (${task.reviewRejectCount}/3)`,
                description: `Project: ${project.name} (${projectId}) | Task: ${taskId}`,
                project: projectId,
                projectName: project.name,
                taskId: taskId,
                rejectCount: task.reviewRejectCount,
                status: 'completed'
            });
            writeActivityData(activityData);
        } catch (err) {
            console.error('[ACTIVITY] Failed to log rejection:', err.message);
        }

        console.log(`[ORCHESTRATOR] Task "${task.title}" (${taskId}) rejected by REVAGENT (${task.reviewRejectCount}/3)`);

        res.json({
            success: true,
            task: task,
            message: `Task auf "offen" zurückgesetzt (${task.reviewRejectCount}/3 rejections)`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET: All in-progress tasks with their assigned agent and project info
app.get('/api/orchestrator/in-progress-tasks', (req, res) => {
    try {
        const data = readData();
        const inProgressTasks = [];

        for (const project of data.projects) {
            const tasks = project.tasks.filter(t => normalizeStatus(t.status) === 'in-progress');
            for (const task of tasks) {
                inProgressTasks.push({
                    projectId: project.id,
                    projectName: project.name,
                    projectPath: project.path || null,
                    taskId: task.id,
                    taskTitle: task.title,
                    assignedAgent: task.assignedAgent || null,
                    delegatedAt: task.delegatedAt || null,
                    status: task.status
                });
            }
        }

        res.json({ success: true, tasks: inProgressTasks });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Snapshot backup every 10 minutes (even without writes)
setInterval(() => createSnapshotBackup(true), 10 * 60 * 1000);

// Start server
app.listen(PORT, HOST, () => {
    console.log(`\n🦞 OpenClaw Board v2\n`);
    console.log(`   🌐 http://0.0.0.0:${PORT}`);
    console.log(`   📡 API: http://localhost:${PORT}/api/projects\n`);
});
