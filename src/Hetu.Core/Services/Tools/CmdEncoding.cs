using System.Globalization;
using System.Text;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// cmd.exe 输出编码：管道重定向时其内置命令（dir、type、echo 等）按系统 OEM 代码页输出字节
/// （简体中文下为 GBK/936），必须按同一代码页解码，否则中文输出会是乱码。
/// </summary>
internal static class CmdEncoding
{
    public static readonly Encoding Oem = Create();

    private static Encoding Create()
    {
        // .NET 默认只内置 Unicode 编码，936 等代码页需先注册提供程序
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        return Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage);
    }
}
