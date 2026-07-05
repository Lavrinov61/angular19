/// Generated protobuf code from tonic_build.
/// File descriptor set for reflection service.
pub const FILE_DESCRIPTOR_SET: &[u8] = include_bytes!("descriptor.bin");

pub mod svf {
    pub mod common {
        pub mod v1 {
            tonic::include_proto!("svf.common.v1");
        }
    }
    pub mod platform {
        pub mod v1 {
            tonic::include_proto!("svf.platform.v1");
        }
    }
    pub mod auth {
        pub mod v1 {
            tonic::include_proto!("svf.auth.v1");
        }
    }
    pub mod chat {
        pub mod v1 {
            tonic::include_proto!("svf.chat.v1");
        }
    }
    pub mod orders {
        pub mod v1 {
            tonic::include_proto!("svf.orders.v1");
        }
    }
    pub mod media {
        pub mod v1 {
            tonic::include_proto!("svf.media.v1");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message;
    use prost_types::FileDescriptorSet;
    use std::collections::BTreeSet;

    #[test]
    fn reflection_descriptor_exposes_mobile_bff_contract_only() {
        let descriptor =
            FileDescriptorSet::decode(FILE_DESCRIPTOR_SET).expect("descriptor set decodes");
        let packages = descriptor
            .file
            .iter()
            .filter_map(|file| file.package.as_deref())
            .collect::<BTreeSet<_>>();

        for package in [
            "grpc.health.v1",
            "svf.common.v1",
            "svf.platform.v1",
            "svf.auth.v1",
            "svf.chat.v1",
            "svf.orders.v1",
            "svf.media.v1",
        ] {
            assert!(packages.contains(package), "missing package {package}");
        }

        for package in ["svf.gateway.v1", "svf.infra.v1", "svf.print.v1"] {
            assert!(
                !packages.contains(package),
                "internal package leaked: {package}"
            );
        }

        let services = descriptor
            .file
            .iter()
            .flat_map(|file| {
                let package = file.package.as_deref().unwrap_or_default();
                file.service
                    .iter()
                    .map(move |service| format!("{package}.{}", service.name()))
            })
            .collect::<BTreeSet<_>>();

        let expected_services = [
            "grpc.health.v1.Health",
            "svf.platform.v1.ConfigService",
            "svf.auth.v1.AuthService",
            "svf.chat.v1.ChatService",
            "svf.orders.v1.OrderService",
            "svf.media.v1.MediaService",
        ]
        .into_iter()
        .map(str::to_string)
        .collect::<BTreeSet<_>>();

        assert_eq!(services, expected_services);
    }
}
