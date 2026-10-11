namespace Hetu.Shared.Agent;

/// <summary>运行中引导请求：把这条消息注入当前正在执行的 Agent 循环</summary>
public class SteerMessageRequest
{
    public string Content { get; set; } = string.Empty;
}

/// <summary>运行中引导结果：false = 当前没有正在运行的流，调用方应改为排队或正常发送</summary>
public class SteerResultDto
{
    public bool Injected { get; set; }
}
