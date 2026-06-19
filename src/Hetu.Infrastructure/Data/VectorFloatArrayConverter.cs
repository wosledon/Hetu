using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Pgvector;

namespace Hetu.Infrastructure.Data;

public class VectorFloatArrayConverter : ValueConverter<float[], Vector>
{
    public VectorFloatArrayConverter()
        : base(
            v => v == null ? new Vector(Array.Empty<float>()) : new Vector(v),
            v => v.ToArray())
    {
    }
}
