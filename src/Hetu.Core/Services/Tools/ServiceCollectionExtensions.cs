using Hetu.Core.Interfaces;
using Microsoft.Extensions.DependencyInjection;

namespace Hetu.Core.Services.Tools;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddToolExecutors(this IServiceCollection services)
    {
        services.AddScoped<IToolExecutor, SearchNotesTool>();
        services.AddScoped<IToolExecutor, ReadNoteTool>();
        services.AddScoped<IToolExecutor, CreateNoteTool>();
        services.AddScoped<IToolExecutor, UpdateNoteTool>();
        services.AddScoped<IToolExecutor, ListNotesTool>();
        services.AddScoped<IToolExecutor, DeleteNoteTool>();
        services.AddScoped<IToolExecutor, MoveNoteTool>();
        services.AddScoped<IToolExecutor, ListNoteVersionsTool>();
        services.AddScoped<IToolExecutor, RestoreNoteVersionTool>();
        services.AddScoped<IToolExecutor, ListNotebooksTool>();
        services.AddScoped<IToolExecutor, CreateNotebookTool>();
        services.AddScoped<IToolExecutor, ListTagsTool>();
        services.AddScoped<IToolExecutor, SetNoteTagsTool>();
        services.AddScoped<IToolExecutor, ListKnowledgeItemsTool>();
        services.AddScoped<IToolExecutor, SearchWebTool>();
        services.AddScoped<IToolExecutor, SearchMemoryTool>();
        services.AddScoped<IToolExecutor, CreateMemoryTool>();
        services.AddScoped<IToolExecutor, ListMemoriesTool>();
        services.AddScoped<IToolExecutor, DeleteMemoryTool>();
        services.AddScoped<IToolExecutor, SearchGraphTool>();
        services.AddScoped<IToolExecutor, AskQuestionTool>();
        services.AddScoped<IToolExecutor, TodoTool>();
        services.AddScoped<IToolExecutor, PlanTool>();
        services.AddScoped<IToolExecutor, RunCommandTool>();
        services.AddScoped<IToolExecutor, CreateScheduledTaskTool>();
        services.AddScoped<IToolExecutor, ListScheduledTasksTool>();
        services.AddScoped<IToolExecutor, DeleteScheduledTaskTool>();
        services.AddScoped<IToolExecutor, ListSkillsTool>();
        // 项目 / 任务看板 / Wiki / 工作流 / 智能体 / 标签 / 知识库条目 / 收件箱 / 用量统计
        services.AddScoped<IToolExecutor, ListProjectsTool>();
        services.AddScoped<IToolExecutor, CreateProjectTool>();
        services.AddScoped<IToolExecutor, UpdateProjectTool>();
        services.AddScoped<IToolExecutor, DeleteProjectTool>();
        services.AddScoped<IToolExecutor, ListWorkProjectsTool>();
        services.AddScoped<IToolExecutor, ListKanbanTasksTool>();
        services.AddScoped<IToolExecutor, CreateKanbanTaskTool>();
        services.AddScoped<IToolExecutor, UpdateKanbanTaskTool>();
        services.AddScoped<IToolExecutor, MoveKanbanTaskTool>();
        services.AddScoped<IToolExecutor, DeleteKanbanTaskTool>();
        services.AddScoped<IToolExecutor, ListWikiDocsTool>();
        services.AddScoped<IToolExecutor, ReadWikiDocTool>();
        services.AddScoped<IToolExecutor, ListWorkflowsTool>();
        services.AddScoped<IToolExecutor, RunWorkflowTool>();
        services.AddScoped<IToolExecutor, ListAgentsTool>();
        services.AddScoped<IToolExecutor, UseSkillTool>();
        // 内置技能 / 智能体 / 工作流的增删改
        services.AddScoped<IToolExecutor, CreateSkillTool>();
        services.AddScoped<IToolExecutor, UpdateSkillTool>();
        services.AddScoped<IToolExecutor, DeleteSkillTool>();
        services.AddScoped<IToolExecutor, CreateAgentTool>();
        services.AddScoped<IToolExecutor, UpdateAgentTool>();
        services.AddScoped<IToolExecutor, DeleteAgentTool>();
        services.AddScoped<IToolExecutor, CreateWorkflowTool>();
        services.AddScoped<IToolExecutor, UpdateWorkflowTool>();
        services.AddScoped<IToolExecutor, DeleteWorkflowTool>();
        services.AddScoped<IToolExecutor, CreateTagTool>();
        services.AddScoped<IToolExecutor, UpdateTagTool>();
        services.AddScoped<IToolExecutor, DeleteTagTool>();
        services.AddScoped<IToolExecutor, ReadKnowledgeItemTool>();
        services.AddScoped<IToolExecutor, GetUsageStatsTool>();
        services.AddScoped<IToolExecutor, ListInboxItemsTool>();
        services.AddScoped<IToolExecutor, UpdateInboxItemsTool>();
        services.AddScoped<IToolExecutor, WorkListDirTool>();
        services.AddScoped<IToolExecutor, WorkReadFileTool>();
        services.AddScoped<IToolExecutor, WorkWriteFileTool>();
        services.AddScoped<IToolExecutor, WorkRunCommandTool>();
        services.AddScoped<IToolExecutor, WorkApplyPatchTool>();
        services.AddScoped<IToolExecutor, WorkGlobTool>();
        services.AddScoped<IToolExecutor, WorkGrepTool>();
        services.AddScoped<IToolExecutor, WorkDeleteFileTool>();
        services.AddScoped<IToolExecutor, WorkMoveFileTool>();
        services.AddScoped<IToolExecutor, WorkGitTool>();
        services.AddScoped<IToolExecutor, WorkTaskTool>();
        services.AddScoped<IToolExecutor, WorkDiagnosticsTool>();
        services.AddScoped<IToolExecutor, WorkUseSkillTool>();
        services.AddScoped<IToolExecutor, WorkSemanticSearchTool>();
        services.AddScoped<WorkToolContext>();
        services.AddScoped<ToolRegistry>();
        services.AddScoped<PromptComposer>();
        services.AddScoped<Hetu.Core.Services.Work.IWorkCommandRunnerFactory, Hetu.Core.Services.Work.WorkCommandRunnerFactory>();
        return services;
    }
}
