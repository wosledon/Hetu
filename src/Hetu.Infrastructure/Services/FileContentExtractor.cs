using System.Text;
using DocumentFormat.OpenXml.Packaging;
using UglyToad.PdfPig;

namespace Hetu.Infrastructure.Services;

/// <summary>
/// 文件内容提取服务，支持 TXT/MD/PDF/DOCX 等格式
/// </summary>
public static class FileContentExtractor
{
    /// <summary>
    /// 根据文件类型提取文本内容
    /// </summary>
    public static async Task<string> ExtractAsync(string filePath, string? mimeType, CancellationToken cancellationToken = default)
    {
        var ext = Path.GetExtension(filePath).ToLowerInvariant();

        try
        {
            return ext switch
            {
                ".txt" or ".md" or ".markdown" or ".rst" or ".csv" or ".json" or ".xml" or ".yaml" or ".yml"
                    or ".html" or ".htm" or ".css" or ".js" or ".ts" or ".py" or ".cs" or ".java" or ".go"
                    or ".rs" or ".cpp" or ".c" or ".h" or ".sh" or ".bat" or ".ps1" or ".sql"
                    => await File.ReadAllTextAsync(filePath, Encoding.UTF8, cancellationToken),

                ".pdf" => ExtractPdf(filePath),

                ".docx" => ExtractDocx(filePath),

                ".doc" => await File.ReadAllTextAsync(filePath, Encoding.UTF8, cancellationToken),

                _ => await TryReadAsTextAsync(filePath, cancellationToken),
            };
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string ExtractPdf(string filePath)
    {
        var sb = new StringBuilder();
        using var document = PdfDocument.Open(filePath);

        foreach (var page in document.GetPages())
        {
            var text = page.Text;
            if (!string.IsNullOrWhiteSpace(text))
            {
                sb.AppendLine(text);
                sb.AppendLine();
            }
        }

        return sb.ToString().Trim();
    }

    private static string ExtractDocx(string filePath)
    {
        var sb = new StringBuilder();
        using var doc = WordprocessingDocument.Open(filePath, false);
        var body = doc.MainDocumentPart?.Document?.Body;

        if (body == null) return string.Empty;

        foreach (var paragraph in body.Elements<DocumentFormat.OpenXml.Wordprocessing.Paragraph>())
        {
            var text = paragraph.InnerText;
            if (!string.IsNullOrWhiteSpace(text))
            {
                sb.AppendLine(text);
            }
        }

        return sb.ToString().Trim();
    }

    private static async Task<string> TryReadAsTextAsync(string filePath, CancellationToken cancellationToken)
    {
        try
        {
            // 尝试以 UTF-8 读取
            var bytes = await File.ReadAllBytesAsync(filePath, cancellationToken);

            // 检查是否是二进制文件（检查前 8KB 中的 null 字节）
            var checkLen = Math.Min(bytes.Length, 8192);
            for (int i = 0; i < checkLen; i++)
            {
                if (bytes[i] == 0) return string.Empty; // 二进制文件
            }

            return Encoding.UTF8.GetString(bytes);
        }
        catch
        {
            return string.Empty;
        }
    }

    /// <summary>
    /// 判断文件是否支持文本提取
    /// </summary>
    public static bool IsSupported(string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext is
            ".txt" or ".md" or ".markdown" or ".rst" or ".csv" or ".json" or ".xml"
            or ".yaml" or ".yml" or ".html" or ".htm" or ".css" or ".js" or ".ts"
            or ".py" or ".cs" or ".java" or ".go" or ".rs" or ".cpp" or ".c" or ".h"
            or ".sh" or ".bat" or ".ps1" or ".sql"
            or ".pdf" or ".docx" or ".doc";
    }
}
