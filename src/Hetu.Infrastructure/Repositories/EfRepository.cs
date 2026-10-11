using System.Linq.Expressions;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Infrastructure.Repositories;

public class EfRepository<T> : IRepository<T> where T : BaseEntity
{
    protected readonly HetuDbContext Context;
    protected readonly DbSet<T> DbSet;

    public EfRepository(HetuDbContext context)
    {
        Context = context;
        DbSet = context.Set<T>();
    }

    public virtual Task<T?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
        => DbSet.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id, cancellationToken);

    public virtual async Task<IReadOnlyList<T>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var result = await DbSet.AsNoTracking().ToListAsync(cancellationToken);
        return result;
    }

    public virtual async Task<IReadOnlyList<T>> FindAsync(Expression<Func<T, bool>> predicate, CancellationToken cancellationToken = default)
    {
        var result = await DbSet.AsNoTracking().Where(predicate).ToListAsync(cancellationToken);
        return result;
    }

    public virtual async Task<IReadOnlyList<T>> FindIgnoreQueryFilterAsync(Expression<Func<T, bool>> predicate, CancellationToken cancellationToken = default)
    {
        var result = await DbSet.IgnoreQueryFilters().AsNoTracking().Where(predicate).ToListAsync(cancellationToken);
        return result;
    }

    public virtual Task<int> CountAsync(Expression<Func<T, bool>>? predicate = null, CancellationToken cancellationToken = default)
        => predicate == null
            ? DbSet.CountAsync(cancellationToken)
            : DbSet.CountAsync(predicate, cancellationToken);

    public virtual Task<List<TResult>> SelectAsync<TResult>(Expression<Func<T, bool>> predicate, Expression<Func<T, TResult>> selector, CancellationToken cancellationToken = default)
        => DbSet.AsNoTracking().Where(predicate).Select(selector).ToListAsync(cancellationToken);

    public virtual async Task<int> PruneAsync(Expression<Func<T, bool>> predicate, Expression<Func<T, DateTimeOffset>> orderBy, int keep, CancellationToken cancellationToken = default)
    {
        List<Guid> keepIds;
        if (Context.Database.IsSqlite())
        {
            // SQLite 的 EF provider 不支持在 SQL 中排序 DateTimeOffset：只投影 Id + 排序键（不加载实体）后在内存定序
            var keyName = orderBy.Body is MemberExpression member
                ? member.Member.Name
                : throw new ArgumentException("排序键必须是实体属性", nameof(orderBy));

            var rows = await DbSet.AsNoTracking()
                .Where(predicate)
                .Select(e => new { e.Id, Key = EF.Property<DateTimeOffset>(e, keyName) })
                .ToListAsync(cancellationToken);

            keepIds = rows.OrderByDescending(r => r.Key).Take(keep).Select(r => r.Id).ToList();
        }
        else
        {
            // 只查询要保留的 Id（数据库排序 + 取前 keep 条），再用一条 DELETE 清掉其余的
            keepIds = await DbSet.AsNoTracking()
                .Where(predicate)
                .OrderByDescending(orderBy)
                .Take(keep)
                .Select(e => e.Id)
                .ToListAsync(cancellationToken);
        }

        return await DbSet
            .Where(predicate)
            .Where(e => !keepIds.Contains(e.Id))
            .ExecuteDeleteAsync(cancellationToken);
    }

    public virtual async Task<T> AddAsync(T entity, CancellationToken cancellationToken = default)
    {
        await DbSet.AddAsync(entity, cancellationToken);
        return entity;
    }

    public virtual Task<T> UpdateAsync(T entity, CancellationToken cancellationToken = default)
    {
        // GetByIdAsync 走 AsNoTracking，同一作用域内可能已跟踪同 Id 的旧实例，
        // 此时 DbSet.Update 会抛 “another instance with the same key value is already being tracked”。
        // 不能改用 Detach 解绑旧实例：EF 会连带解绑关系图上的实体（如刚 Add 的消息），导致该实体静默丢失。
        var tracked = DbSet.Local.FirstOrDefault(e => e.Id == entity.Id);
        if (tracked != null && !ReferenceEquals(tracked, entity))
        {
            Context.Entry(tracked).CurrentValues.SetValues(entity);
            return Task.FromResult(tracked);
        }

        // 同一实例已被跟踪（如本作用域内刚 Add 的新实体）时不能再调 DbSet.Update：
        // 它会把 Added 状态改写为 Modified，SaveChanges 于是发出影响 0 行的 UPDATE 并抛并发异常
        if (tracked != null)
            return Task.FromResult(entity);

        DbSet.Update(entity);
        return Task.FromResult(entity);
    }

    public virtual Task DeleteAsync(T entity, CancellationToken cancellationToken = default)
    {
        DbSet.Remove(entity);
        return Task.CompletedTask;
    }

    public virtual Task TouchUpdatedAtAsync(Guid id, CancellationToken cancellationToken = default)
        => DbSet
            .Where(e => e.Id == id)
            .ExecuteUpdateAsync(s => s.SetProperty(e => e.UpdatedAt, DateTimeOffset.UtcNow), cancellationToken);
}
