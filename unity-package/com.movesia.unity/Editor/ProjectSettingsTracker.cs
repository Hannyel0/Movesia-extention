#if UNITY_EDITOR
using UnityEngine;
using UnityEngine.Rendering;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.PackageManager;
using System;
using System.Linq;

/// <summary>
/// Captures Unity project settings on-demand.
/// </summary>
public static class ProjectSettingsTracker
{
    // --- Data Structures ---
    
    [Serializable]
    public class ProjectSettingsSnapshot
    {
        public long timestamp;
        public EnvironmentInfo environment;
        public PlayerSettingsData player;
        public BuildSettingsData build;
        public QualitySettingsData quality;
        public PhysicsSettingsData physics;
        public TimeSettingsData time;
        public AudioSettingsData audio;
        public RenderingSettingsData rendering;
        public PackageData[] packages;
    }
    
    [Serializable]
    public class EnvironmentInfo
    {
        public string unityVersion;
        public string platform;
        public string projectPath;
        public string projectName;
    }
    
    [Serializable]
    public class PlayerSettingsData
    {
        public string productName;
        public string companyName;
        public string bundleVersion;
        public string applicationIdentifier;
        public int defaultScreenWidth;
        public int defaultScreenHeight;
        public string fullScreenMode;
        public bool runInBackground;
    }
    
    [Serializable]
    public class BuildSettingsData
    {
        public string activeBuildTarget;
        public string scriptingBackend;
        public string apiCompatibilityLevel;
        public string il2CppCompilerConfiguration;
        public string managedStrippingLevel;
        public string scriptingDefineSymbols;
        public bool allowUnsafeCode;
        public bool development;
    }
    
    [Serializable]
    public class QualitySettingsData
    {
        public string[] names;
        public int currentLevel;
        public string currentName;
        public int vSyncCount;
        public int antiAliasing;
        public string shadowQuality;
        public float shadowDistance;
        public int pixelLightCount;
        public string textureQuality;
        public string anisotropicFiltering;
    }
    
    [Serializable]
    public class PhysicsSettingsData
    {
        public float gravityX;
        public float gravityY;
        public float gravityZ;
        public float defaultSolverIterations;
        public float defaultSolverVelocityIterations;
        public float bounceThreshold;
        public float sleepThreshold;
        public float defaultContactOffset;
        public bool autoSimulation;
        public bool autoSyncTransforms;
    }
    
    [Serializable]
    public class TimeSettingsData
    {
        public float fixedDeltaTime;
        public float maximumDeltaTime;
        public float timeScale;
        public float maximumParticleDeltaTime;
    }
    
    [Serializable]
    public class AudioSettingsData
    {
        public string speakerMode;
        public int sampleRate;
        public int dspBufferSize;
        public int numRealVoices;
        public int numVirtualVoices;
    }
    
    [Serializable]
    public class RenderingSettingsData
    {
        public string colorSpace;
        public string[] graphicsAPIs;
        public bool graphicsJobs;
        public string renderPipeline;
        public string renderPipelineAsset;
        public bool gpuSkinning;
        public bool stripEngineCode;
        public bool gcIncremental;
    }
    
    [Serializable]
    public class PackageData
    {
        public string name;
        public string version;
        public string source;
    }
    
    // --- Public API ---
    
    /// <summary>
    /// Capture full project settings snapshot.
    /// </summary>
    public static ProjectSettingsSnapshot CaptureSnapshot()
    {
        return new ProjectSettingsSnapshot
        {
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            environment = CaptureEnvironment(),
            player = CapturePlayerSettings(),
            build = CaptureBuildSettings(),
            quality = CaptureQualitySettings(),
            physics = CapturePhysicsSettings(),
            time = CaptureTimeSettings(),
            audio = CaptureAudioSettings(),
            rendering = CaptureRenderingSettings(),
            packages = CapturePackages()
        };
    }
    
    /// <summary>
    /// Capture only a specific category of settings.
    /// </summary>
    public static object CaptureCategory(string category)
    {
        return category.ToLowerInvariant() switch
        {
            "environment" => CaptureEnvironment(),
            "player" => CapturePlayerSettings(),
            "build" => CaptureBuildSettings(),
            "quality" => CaptureQualitySettings(),
            "physics" => CapturePhysicsSettings(),
            "time" => CaptureTimeSettings(),
            "audio" => CaptureAudioSettings(),
            "rendering" => CaptureRenderingSettings(),
            "packages" => CapturePackages(),
            _ => null
        };
    }
    
    // --- Private Capture Methods ---
    
    private static EnvironmentInfo CaptureEnvironment()
    {
        return new EnvironmentInfo
        {
            unityVersion = Application.unityVersion,
            platform = Application.platform.ToString(),
            projectPath = Application.dataPath.Replace("/Assets", ""),
            projectName = Application.productName
        };
    }
    
    private static PlayerSettingsData CapturePlayerSettings()
    {
        var namedBuildTarget = GetCurrentNamedBuildTarget();
        
        return new PlayerSettingsData
        {
            productName = PlayerSettings.productName,
            companyName = PlayerSettings.companyName,
            bundleVersion = PlayerSettings.bundleVersion,
            applicationIdentifier = SafeGet(() => PlayerSettings.GetApplicationIdentifier(namedBuildTarget), ""),
            defaultScreenWidth = PlayerSettings.defaultScreenWidth,
            defaultScreenHeight = PlayerSettings.defaultScreenHeight,
            fullScreenMode = PlayerSettings.fullScreenMode.ToString(),
            runInBackground = PlayerSettings.runInBackground
        };
    }
    
    private static BuildSettingsData CaptureBuildSettings()
    {
        var namedBuildTarget = GetCurrentNamedBuildTarget();
        
        return new BuildSettingsData
        {
            activeBuildTarget = EditorUserBuildSettings.activeBuildTarget.ToString(),
            scriptingBackend = SafeGet(() => PlayerSettings.GetScriptingBackend(namedBuildTarget).ToString(), "Unknown"),
            apiCompatibilityLevel = SafeGet(() => PlayerSettings.GetApiCompatibilityLevel(namedBuildTarget).ToString(), "Unknown"),
            il2CppCompilerConfiguration = SafeGet(() => PlayerSettings.GetIl2CppCompilerConfiguration(namedBuildTarget).ToString(), "Unknown"),
            managedStrippingLevel = SafeGet(() => PlayerSettings.GetManagedStrippingLevel(namedBuildTarget).ToString(), "Unknown"),
            scriptingDefineSymbols = SafeGet(() => PlayerSettings.GetScriptingDefineSymbols(namedBuildTarget), ""),
            allowUnsafeCode = PlayerSettings.allowUnsafeCode,
            development = EditorUserBuildSettings.development
        };
    }
    
    private static QualitySettingsData CaptureQualitySettings()
    {
        return new QualitySettingsData
        {
            names = QualitySettings.names,
            currentLevel = QualitySettings.GetQualityLevel(),
            currentName = QualitySettings.names[QualitySettings.GetQualityLevel()],
            vSyncCount = QualitySettings.vSyncCount,
            antiAliasing = QualitySettings.antiAliasing,
            shadowQuality = QualitySettings.shadows.ToString(),
            shadowDistance = QualitySettings.shadowDistance,
            pixelLightCount = QualitySettings.pixelLightCount,
            textureQuality = QualitySettings.globalTextureMipmapLimit.ToString(),
            anisotropicFiltering = QualitySettings.anisotropicFiltering.ToString()
        };
    }
    
    private static PhysicsSettingsData CapturePhysicsSettings()
    {
        return new PhysicsSettingsData
        {
            gravityX = Physics.gravity.x,
            gravityY = Physics.gravity.y,
            gravityZ = Physics.gravity.z,
            defaultSolverIterations = Physics.defaultSolverIterations,
            defaultSolverVelocityIterations = Physics.defaultSolverVelocityIterations,
            bounceThreshold = Physics.bounceThreshold,
            sleepThreshold = Physics.sleepThreshold,
            defaultContactOffset = Physics.defaultContactOffset,
            autoSimulation = Physics.simulationMode != SimulationMode.Script,
            autoSyncTransforms = Physics.autoSyncTransforms
        };
    }
    
    private static TimeSettingsData CaptureTimeSettings()
    {
        return new TimeSettingsData
        {
            fixedDeltaTime = Time.fixedDeltaTime,
            maximumDeltaTime = Time.maximumDeltaTime,
            timeScale = Time.timeScale,
            maximumParticleDeltaTime = Time.maximumParticleDeltaTime
        };
    }
    
    private static AudioSettingsData CaptureAudioSettings()
    {
        var config = AudioSettings.GetConfiguration();
        
        return new AudioSettingsData
        {
            speakerMode = config.speakerMode.ToString(),
            sampleRate = config.sampleRate,
            dspBufferSize = config.dspBufferSize,
            numRealVoices = config.numRealVoices,
            numVirtualVoices = config.numVirtualVoices
        };
    }
    
    private static RenderingSettingsData CaptureRenderingSettings()
    {
        var buildTarget = EditorUserBuildSettings.activeBuildTarget;
        var currentRP = GraphicsSettings.currentRenderPipeline;
        
        return new RenderingSettingsData
        {
            colorSpace = PlayerSettings.colorSpace.ToString(),
            graphicsAPIs = SafeGet(() => 
                PlayerSettings.GetGraphicsAPIs(buildTarget)
                    .Select(api => api.ToString())
                    .ToArray(), 
                Array.Empty<string>()),
            graphicsJobs = PlayerSettings.graphicsJobs,
            renderPipeline = GetRenderPipelineType(currentRP),
            renderPipelineAsset = currentRP != null ? currentRP.name : "None",
            gpuSkinning = PlayerSettings.gpuSkinning,
            stripEngineCode = PlayerSettings.stripEngineCode,
            gcIncremental = PlayerSettings.gcIncremental
        };
    }
    
    private static PackageData[] CapturePackages()
    {
        try
        {
            // Synchronous - uses cached package info
            var packages = UnityEditor.PackageManager.PackageInfo.GetAllRegisteredPackages();
            
            return packages
                .Where(p => p.source != PackageSource.BuiltIn) // Exclude built-in modules
                .Select(p => new PackageData
                {
                    name = p.name,
                    version = p.version,
                    source = p.source.ToString()
                })
                .ToArray();
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"Failed to capture packages: {ex.Message}");
            return Array.Empty<PackageData>();
        }
    }
    
    // --- Helpers ---
    
    private static NamedBuildTarget GetCurrentNamedBuildTarget()
    {
        var buildTarget = EditorUserBuildSettings.activeBuildTarget;
        var buildTargetGroup = BuildPipeline.GetBuildTargetGroup(buildTarget);
        return NamedBuildTarget.FromBuildTargetGroup(buildTargetGroup);
    }
    
    private static string GetRenderPipelineType(RenderPipelineAsset asset)
    {
        if (asset == null)
            return "Built-in";
            
        var typeName = asset.GetType().Name;
        
        if (typeName.Contains("Universal") || typeName.Contains("URP"))
            return "URP";
        if (typeName.Contains("HDRenderPipeline") || typeName.Contains("HDRP"))
            return "HDRP";
            
        return "Custom SRP";
    }
    
    private static T SafeGet<T>(Func<T> getter, T fallback)
    {
        try
        {
            return getter();
        }
        catch
        {
            return fallback;
        }
    }
}
#endif