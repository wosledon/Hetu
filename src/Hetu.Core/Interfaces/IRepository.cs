using System.Linq.Expressions;
using Hetu.Core.Entities;

namespace Hetu.Core.Interfaces;

public interface IRepository<T> where T : BaseEntity
{
    Task<T?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<T>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<T>> FindAsync(Expression<Func<T, bool>> predicate, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<T>> FindIgnoreQueryFilterAsync(Expression<Func<T, bool>> predicate, CancellationToken cancellationToken = default);

    /// <summary>按条件计数：走 SQL COUNT，不把实体读进内存</summary>
    Task<int> CountAsync(Expression<Func<T, bool>>? predicate = null, CancellationToken cancellationToken = default);

    /// <summary>按条件只取部分字段（SQL SELECT，不物化完整实体）</summary>
    Task<List<TResult>> SelectAsync<TResult>(Expression<Func<T, bool>> predicate, Expression<Func<T, TResult>> selector, CancellationToken cancellationToken = default);

    /// <summary>只保留排序后前 keep 条，其余按一条 SQL DELETE 清理（不加载实体）</summary>
    Task<int> PruneAsync(Expression<Func<T, bool>> predicate, Expression<Func<T, DateTimeOffset>> orderBy, int keep, CancellationToken cancellationToken = default);

    /// <summary>按键值分组计数（SQL GROUP BY，不加载实体）</summary>
    Task<Dictionary<TKey, int>> CountByAsync<TKey>(
        Expression<Func<T, bool>>? predicate,
        Expression<Func<T, TKey>> keySelector,
        CancellationToken cancellationToken = default) where TKey : notnull;

    /// <summary>按时间字段排序取一页（数据库侧分页；SQLite 不支持排序 DateTimeOffset，退化为投影排序键后在内存取页）</summary>
    Task<List<T>> GetPagedByDateAsync(
        Expression<Func<T, bool>>? predicate,
        Expression<Func<T, DateTimeOffset>> orderBy,
        bool descending,
        int skip,
        int take,
        CancellationToken cancellationToken = default);

    Task<T> AddAsync(T entity, CancellationToken cancellationToken = default);
    Task<T> UpdateAsync(T entity, CancellationToken cancellationToken = default);
    Task DeleteAsync(T entity, CancellationToken cancellationToken = default);
    Task TouchUpdatedAtAsync(Guid id, CancellationToken cancellationToken = default);
}
