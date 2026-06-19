using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IChatOrganizeService
{
    IAsyncEnumerable<string> OrganizeTopicAsync(Guid topicId, OrganizeTopicRequest request, CancellationToken cancellationToken = default);
}
