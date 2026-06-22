using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Tasks;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.ScheduledTasks;

/// <summary>
/// 执行 Skill 的定时任务执行器
/// </summary>
public class SkillScheduledTaskExecutor : IScheduledTaskExecutor
{
    private readonly ISkillService _skillService;
    private readonly ILocalSkillService _localSkillService;
    private readonly ILogger<SkillScheduledTaskExecutor> _logger;

    public SkillScheduledTaskExecutor(
        ISkillService skillService,
        ILocalSkillService localSkillService,
        ILogger<SkillScheduledTaskExecutor> logger)
    {
        _skillService = skillService;
        _localSkillService = localSkillService;
        _logger = logger;
    }

    public string Kind => ScheduledTaskKinds.Skill;

    public async Task<string> ExecuteAsync(ScheduledTask task, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(task.TargetId))
            throw new InvalidOperationException("缺少目标技能 ID");

        var input = task.Parameters ?? string.Empty;
        var request = new InvokeSkillRequest { Input = input };

        // 本地技能：TargetId 以 "local:" 开头
        if (task.TargetId.StartsWith("local:", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogInformation("定时执行本地技能 {SkillId}({SkillName})", task.TargetId, task.TargetName);

            var localResp = await _localSkillService.ScanAllAsync(cancellationToken);
            var localSkill = (localResp.Data ?? new List<LocalSkillDto>())
                .FirstOrDefault(s => string.Equals(s.Id, task.TargetId, StringComparison.OrdinalIgnoreCase));

            if (localSkill == null)
                throw new InvalidOperationException($"本地技能 '{task.TargetName ?? task.TargetId}' 不存在或已被移除");

            var resp = await _skillService.InvokeLocalAsync(localSkill, input, cancellationToken);
            if (!resp.Success || resp.Data is null)
                throw new InvalidOperationException(resp.Error ?? "本地技能执行未返回结果");

            return Truncate(resp.Data);
        }

        // 数据库技能
        _logger.LogInformation("定时执行技能 {SkillId}({SkillName})", task.TargetId, task.TargetName);

        var dbResp = await _skillService.InvokeAsync(task.TargetId, request, cancellationToken);
        if (!dbResp.Success || dbResp.Data is null)
            throw new InvalidOperationException(dbResp.Error ?? "技能执行未返回结果");

        return Truncate(dbResp.Data);
    }

    private static string Truncate(string result) =>
        result.Length > 500 ? result[..500] + "..." : result;
}
