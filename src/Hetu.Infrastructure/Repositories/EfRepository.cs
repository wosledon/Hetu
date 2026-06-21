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

    public virtual async Task<T> AddAsync(T entity, CancellationToken cancellationToken = default)
    {
        await DbSet.AddAsync(entity, cancellationToken);
        return entity;
    }

    public virtual Task<T> UpdateAsync(T entity, CancellationToken cancellationToken = default)
    {
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
