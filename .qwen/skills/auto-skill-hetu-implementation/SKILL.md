---
name: hetu-implementation
description: Implement missing features in Hetu project (backend EF entities, services, controllers, frontend pages)
source: auto-skill
extracted_at: '2026-06-19T04:48:36.024Z'
---

# Hetu Implementation Skill

## Overview
This skill handles implementing missing features in the Hetu project following the established patterns for ASP.NET Core backend and React frontend.

## Backend Implementation Pattern

### 1. Entity Creation
Create entities in `src/Hetu.Core/Entities/`:
- Inherit from `BaseEntity` (Id, CreatedAt, UpdatedAt)
- Define properties with appropriate constraints
- Set up navigation properties for relationships
- Example: `GraphEntity.cs`, `GraphRelation.cs`

### 2. DTOs
Create response/request DTOs in `src/Hetu.Shared/<Module>/`:
- Use PascalCase for property names
- Follow existing naming conventions (e.g., `<Entity>Dto`, `Create<Entity>Request`)

### 3. Service Layer
Create service interface in `src/Hetu.Core/Interfaces/`:
- Implement CRUD operations
- Add domain-specific methods (e.g., `ExtractFromNoteAsync`)
- Inject `IUnitOfWork` and `ILLMProviderFactory` for AI features

Create service implementation in `src/Hetu.Core/Services/`:
- Use `_unitOfWork.Repository<T>()` for generic entities
- Handle null checks and error cases
- Follow async/await pattern

### 4. Controller Layer
Create controller in `src/Hetu.Api/Controllers/`:
- Attribute route: `[Route("api/[controller]")]`
- Constructor inject the service
- RESTful endpoints with appropriate HTTP verbs

### 5. Database Configuration
Update `HetuDbContext.cs`:
- Add `DbSet<T>` for new entities
- Add `OnModelCreating` configurations
- Set proper indexes and constraints

**Vector Storage Special Cases:**
- For SQLite: Ensure `SqliteVecInterceptor` is registered in `Program.cs`, use `byte[]` for `NoteEmbedding.Embedding` with `vec0` virtual table in `SyncEmbeddingToVecTableAsync`
- For PostgreSQL: Use `float[]` for `NoteEmbedding.Vector`, configure `HasColumnType("vector")` with `VectorFloatArrayConverter`, add HNSW index: `entity.HasIndex(e => e.Vector).HasMethod("hnsw").HasOperators("vector_cosine_ops")`
- Always add explicit `Dimensions` property on `AiModel` instead of reusing `ContextWindow`
- For nullable vectors in Postgres, use `ValueComparer<float[]>` (not `ValueComparer<float[]?>`)

Update `IUnitOfWork.cs` and `UnitOfWork.cs`:
- Register `Repository<T>` for new entities
- For vector tables, update `NoteRepository` with:
  ```csharp
  public Task SyncEmbeddingToVecTableAsync(Guid noteId, float[] embedding, CancellationToken cancellationToken)
  {
      var vectorText = $"[{string.Join(",", embedding)}]";
      await Context.Database.ExecuteSqlRawAsync(
          "INSERT OR REPLACE INTO vec_note_embeddings (note_id, embedding) VALUES ({0}, {1})",
          new[] { noteId.ToString(), vectorText },
          cancellationToken);
  }
  ```

### 6. Registration
Update `Program.cs`:
- Register service: `builder.Services.AddScoped<IService, Service>()`

### 7. Migration
```bash
dotnet ef migrations add <MigrationName> --project src\Hetu.Infrastructure --startup-project src\Hetu.Api
```

## Semantic Search Optimization

### SQLite vec0 Pattern
- Request `topK * 3` from vec0 as it applies limit before JOIN/IsDeleted filtering
- Example query:
  ```sql
  SELECT n.Id, n.Title, n.Content, n.UpdatedAt
  FROM vec_note_embeddings v
  JOIN Notes n ON n.Id = v.note_id
  WHERE v.embedding MATCH @query AND k = @fetchK AND n.IsDeleted = false
  ORDER BY distance
  LIMIT @topK
  ```

### PostgreSQL pgvector Pattern
- Use `Pgvector.Vector` type in parameters
- Distance operator `<=>` for cosine similarity
- Example:
  ```csharp
  command.CommandText = @"SELECT ... ORDER BY ne.Vector <=> @query LIMIT @topK";
  command.Parameters.Add(new NpgsqlParameter("query", new Vector(queryEmbedding)));
  ```

## Common Error Fixes

| Error | Solution |
|-------|----------|
| `CS0234` - `EntityFrameworkCore` missing | Remove unused `using Microsoft.EntityFrameworkCore` from Core layer |
| `MSB3027` - DLL locked by process | Kill running `Hetu.Api` process before rebuild |
| `TS6133` - Unused variable | Remove unused imports and variables |
| `CS9006`/`CS1733` - Raw string interpolation | Use `jsonExample` variable to avoid brace escaping |
| `vector` type missing in PostgreSQL | Ensure `HasPostgresExtension("vector")` and `UseVector()` in `Startup.cs` |

### 1. Type Definitions
Add TypeScript interfaces in `src/types/index.ts`:
- Match backend DTO structure
- Use camelCase for JSON compatibility

### 2. Service Layer
Create in `src/services/` (e.g., `graphService.ts`):
- Use `get/post/put/del` helpers from `./api`
- Return typed promises

### 3. Page Component
Create in `src/pages/`:
- Import `AppLayout` for consistent layout
- Use `useQuery` for data fetching
- Use `useMutation` for actions with revalidation
- Follow existing patterns from `NotesPage.tsx`, `ChatPage.tsx`

### 4. Component Registration
- Add route in `src/App.tsx`
- Add navigation item in `src/components/Sidebar.tsx`

### 5. Build Verification
```bash
# Backend
dotnet build src\Hetu.Api\Hetu.Api.csproj

# Frontend
cd frontend
npm run build
```

## Known Patterns from Recent Implementations

### Entity-Relationship Patterns
- Use `List<T>` for many-to-many relationships
- Set `OnDelete(DeleteBehavior.Cascade)` for proper cleanup
- Add indexes on foreign keys

### AI Integration
- Inject `ILLMProviderFactory`
- Create chat with system prompt for structured output
- Parse JSON responses with try-catch

### Semantic Search
- Backend: Use `ISemanticSearchService`
- Frontend: Add mode toggle (keyword vs semantic)

### SVG Visualization
- Calculate node positions using force-directed layout
- Use ` Huntington` squared distance for repulsion
- Add hover states with `transition`

## Common Error Fixes

| Error | Solution |
|-------|----------|
| `CS0234` - `EntityFrameworkCore` missing | Remove unused `using Microsoft.EntityFrameworkCore` from Core layer |
| `MSB3027` - DLL locked by process | Kill running `Hetu.Api` process before rebuild |
| `TS6133` - Unused variable | Remove unused imports and variables |
| Injection issues | Verify service registration in `Program.cs` |

## Workflow Summary
1. Check PRD for feature requirements
2. Create backend: Entity → DTOs → Service → Controller → DbContext → Migration
3. Create frontend: Types → Service → Page → Routes
4. Build both sides and fix errors
5. Verify with `dotnet build` and `npm run build`
